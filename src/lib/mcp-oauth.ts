import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  auth,
  UnauthorizedError,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  clearPendingOAuth,
  loadOAuthState,
  saveOAuthState,
  type HttpConnectorSpec,
  type PendingOAuth,
} from "./mcp-store.ts";

export const OAUTH_PENDING_TTL_MS = 30 * 60 * 1000;
const DEFAULT_CALLBACK_ORIGIN = "http://127.0.0.1:18472";

export function defaultRedirectUri(name: string): string {
  return `${DEFAULT_CALLBACK_ORIGIN}/callback/${name}`;
}

export function createOAuthFetch(baseFetch: FetchLike = fetch): FetchLike {
  return async (url, init) => {
    const response = await baseFetch(url, init);
    const reqHeaders = new Headers(init?.headers);
    const reqContentType = reqHeaders.get("content-type")?.toLowerCase() ?? "";
    const resContentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (
      !reqContentType.includes("application/x-www-form-urlencoded") ||
      !resContentType.includes("application/json")
    ) {
      return response;
    }
    const text = await response.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return new Response(text, { status: response.status, headers: response.headers });
    }
    let normalized: Record<string, unknown> = body;
    // Slack oauth.v2.user.access can nest tokens under authed_user or return token_type="user".
    if (body["ok"] === true && !body["access_token"] && typeof body["authed_user"] === "object" && body["authed_user"]) {
      const authed = body["authed_user"] as Record<string, unknown>;
      if (typeof authed["access_token"] === "string") {
        normalized = {
          ...body,
          access_token: authed["access_token"],
          refresh_token: authed["refresh_token"] ?? body["refresh_token"],
          expires_in: authed["expires_in"] ?? body["expires_in"],
          scope: authed["scope"] ?? body["scope"],
          token_type: "Bearer",
        };
      }
    }
    if (
      typeof normalized["access_token"] === "string" &&
      (typeof normalized["token_type"] !== "string" ||
        normalized["token_type"].toLowerCase() === "user")
    ) {
      normalized = { ...normalized, token_type: "Bearer" };
    }
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    return new Response(JSON.stringify(normalized), { status: response.status, headers });
  };
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function validateOAuthCallback(
  rawUrl: string,
  pending: PendingOAuth,
  now = Date.now(),
): { code: string; state: string } {
  if (now - pending.createdAt > OAUTH_PENDING_TTL_MS) {
    throw new Error("That authorization link has expired. Run /connector_connect again.");
  }
  let callback: URL;
  try {
    callback = new URL(rawUrl.trim());
  } catch {
    throw new Error("That is not a valid OAuth callback URL.");
  }
  const expected = new URL(pending.redirectUri);
  const localAllowed =
    expected.protocol === "https:" ||
    (expected.protocol === "http:" &&
      (expected.hostname === "127.0.0.1" || expected.hostname === "localhost"));
  if (!localAllowed || callback.origin !== expected.origin || callback.pathname !== expected.pathname) {
    throw new Error("That callback URL does not match the active connector authorization.");
  }
  const returnedState = callback.searchParams.get("state");
  if (!returnedState || !constantTimeEquals(returnedState, pending.state)) {
    throw new Error("OAuth state mismatch. Run /connector_connect again.");
  }
  const oauthError = callback.searchParams.get("error");
  if (oauthError) {
    const desc = callback.searchParams.get("error_description");
    throw new Error(`Authorization denied: ${oauthError}${desc ? ` (${desc})` : ""}`);
  }
  const code = callback.searchParams.get("code")?.trim();
  if (!code) {
    throw new Error("That callback URL is missing an authorization code.");
  }
  return { code, state: returnedState };
}

export class VaultOAuthProvider implements OAuthClientProvider {
  authorizationUrl?: string;
  private generatedState?: string;

  constructor(
    private readonly sharedDir: string,
    private readonly name: string,
    private readonly spec: HttpConnectorSpec,
    private readonly interactive = false,
  ) {}

  get redirectUrl(): string {
    return this.spec.oauth?.redirectUri ?? defaultRedirectUri(this.name);
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      client_name: "Rachel8",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: this.spec.oauth?.clientSecret ? "client_secret_post" : "none",
      ...(this.spec.oauth?.scope ? { scope: this.spec.oauth.scope } : {}),
    };
  }

  state(): string {
    this.generatedState = randomBytes(24).toString("base64url");
    return this.generatedState;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    if (this.spec.oauth?.clientId) {
      return {
        client_id: this.spec.oauth.clientId,
        ...(this.spec.oauth.clientSecret ? { client_secret: this.spec.oauth.clientSecret } : {}),
      };
    }
    const stored = await loadOAuthState(this.sharedDir, this.name);
    return stored.clientInfo as OAuthClientInformationMixed | undefined;
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    if (this.spec.oauth?.clientId) return;
    const stored = await loadOAuthState(this.sharedDir, this.name);
    await saveOAuthState(this.sharedDir, this.name, {
      ...stored,
      clientInfo: info as unknown as Record<string, unknown>,
    });
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const stored = await loadOAuthState(this.sharedDir, this.name);
    return stored.tokens as OAuthTokens | undefined;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const stored = await loadOAuthState(this.sharedDir, this.name);
    const merged: OAuthTokens = {
      ...tokens,
      token_type: tokens.token_type || "Bearer",
      ...(tokens.refresh_token || !stored.tokens?.refresh_token
        ? {}
        : { refresh_token: stored.tokens.refresh_token }),
    };
    const expiresAt =
      typeof merged.expires_in === "number" ? Date.now() + merged.expires_in * 1000 : undefined;
    const { pending: _, codeVerifier: __, ...rest } = stored;
    await saveOAuthState(this.sharedDir, this.name, {
      ...rest,
      tokens: merged,
      ...(expiresAt ? { expiresAt } : {}),
    });
  }

  async codeVerifier(): Promise<string> {
    const stored = await loadOAuthState(this.sharedDir, this.name);
    if (!stored.codeVerifier) throw new Error(`Missing PKCE verifier for ${this.name}`);
    return stored.codeVerifier;
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    const stored = await loadOAuthState(this.sharedDir, this.name);
    await saveOAuthState(this.sharedDir, this.name, { ...stored, codeVerifier });
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    if (this.spec.oauth?.authorizationEndpoint && this.spec.oauth?.tokenEndpoint) {
      const authUrl = new URL(this.spec.oauth.authorizationEndpoint);
      return {
        authorizationServerUrl: authUrl.origin,
        authorizationServerMetadata: {
          issuer: authUrl.origin,
          authorization_endpoint: this.spec.oauth.authorizationEndpoint,
          token_endpoint: this.spec.oauth.tokenEndpoint,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: this.spec.oauth.clientSecret
            ? ["client_secret_post", "client_secret_basic"]
            : ["none"],
        },
      };
    }
    const stored = await loadOAuthState(this.sharedDir, this.name);
    return stored.discoveryState as OAuthDiscoveryState | undefined;
  }

  async saveDiscoveryState(discoveryState: OAuthDiscoveryState): Promise<void> {
    if (this.spec.oauth?.authorizationEndpoint && this.spec.oauth?.tokenEndpoint) return;
    const stored = await loadOAuthState(this.sharedDir, this.name);
    await saveOAuthState(this.sharedDir, this.name, {
      ...stored,
      discoveryState: discoveryState as unknown as Record<string, unknown>,
    });
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): Promise<void> {
    const stored = await loadOAuthState(this.sharedDir, this.name);
    if (scope === "all") {
      await saveOAuthState(this.sharedDir, this.name, {});
      return;
    }
    const next = { ...stored };
    if (scope === "client") delete next.clientInfo;
    if (scope === "tokens") {
      delete next.tokens;
      delete next.expiresAt;
    }
    if (scope === "verifier") delete next.codeVerifier;
    if (scope === "discovery") delete next.discoveryState;
    await saveOAuthState(this.sharedDir, this.name, next);
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    if (!this.interactive) {
      throw new UnauthorizedError(
        `Connector "${this.name}" needs authorization. Run /connector_connect ${this.name}.`,
      );
    }
    const finalUrl = new URL(url.toString());
    for (const [key, value] of Object.entries(this.spec.oauth?.extraAuthParams ?? {})) {
      if (!finalUrl.searchParams.has(key)) finalUrl.searchParams.set(key, value);
    }
    const state = finalUrl.searchParams.get("state") ?? this.generatedState;
    if (!state) throw new Error(`OAuth authorization URL for ${this.name} is missing state`);
    const stored = await loadOAuthState(this.sharedDir, this.name);
    await saveOAuthState(this.sharedDir, this.name, {
      ...stored,
      pending: {
        state,
        redirectUri: this.redirectUrl,
        authorizationUrl: finalUrl.toString(),
        createdAt: Date.now(),
      },
    });
    this.authorizationUrl = finalUrl.toString();
  }
}

export async function beginConnectorOAuth(
  sharedDir: string,
  name: string,
  spec: HttpConnectorSpec,
  fetchFn: FetchLike = fetch,
): Promise<{ status: "authorized" } | { status: "redirect"; authorizationUrl: string; redirectUri: string }> {
  const existing = await loadOAuthState(sharedDir, name);
  await saveOAuthState(sharedDir, name, existing.clientInfo ? { clientInfo: existing.clientInfo } : {});
  const provider = new VaultOAuthProvider(sharedDir, name, spec, true);
  try {
    const result = await auth(provider, {
      serverUrl: spec.url,
      scope: spec.oauth?.scope,
      fetchFn: createOAuthFetch(fetchFn),
    });
    if (result === "AUTHORIZED") return { status: "authorized" };
    if (!provider.authorizationUrl) {
      throw new Error(`Could not obtain an authorization URL for ${name}.`);
    }
    return {
      status: "redirect",
      authorizationUrl: provider.authorizationUrl,
      redirectUri: provider.redirectUrl,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/registration/i.test(message) && !spec.oauth?.clientId) {
      throw new Error(
        `${name} does not support dynamic client registration. Add oauth.clientId (and clientSecret/redirectUri if required) for "${name}" in ${sharedDir}/vault/mcp/connectors.json, then run /connector_connect ${name}.`,
      );
    }
    throw error;
  }
}

export async function completeConnectorOAuth(
  sharedDir: string,
  name: string,
  spec: HttpConnectorSpec,
  callbackUrl: string,
  fetchFn: FetchLike = fetch,
): Promise<{ expiresAt?: number }> {
  const stored = await loadOAuthState(sharedDir, name);
  if (!stored.pending) {
    throw new Error(`No pending OAuth login for ${name}.`);
  }
  const { code } = validateOAuthCallback(callbackUrl, stored.pending);
  const provider = new VaultOAuthProvider(sharedDir, name, spec, false);
  const result = await auth(provider, {
    serverUrl: spec.url,
    authorizationCode: code,
    scope: spec.oauth?.scope,
    fetchFn: createOAuthFetch(fetchFn),
  });
  if (result !== "AUTHORIZED") {
    throw new Error(`Token exchange for ${name} did not complete.`);
  }
  await clearPendingOAuth(sharedDir, name);
  const updated = await loadOAuthState(sharedDir, name);
  return { expiresAt: updated.expiresAt };
}
