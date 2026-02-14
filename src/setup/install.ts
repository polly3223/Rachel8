import { resolve } from "node:path";
import { logger } from "../lib/logger.ts";
import { errorMessage } from "../lib/errors.ts";

export async function installSystemdService(): Promise<void> {
  const projectDir = resolve(import.meta.dir, "..", "..");
  const user = Bun.env["USER"] ?? "rachel";
  const home = Bun.env["HOME"] ?? `/home/${user}`;
  const standardBunPath = `${home}/.bun/bin/bun`;

  let bunPath = standardBunPath;
  if (!(await Bun.file(standardBunPath).exists())) {
    bunPath = Bun.which("bun") ?? standardBunPath;
  }

  // Enable lingering so user services run without an active login session
  try {
    await run("loginctl", ["enable-linger", user]);
    logger.info(`Enabled lingering for user ${user}`);
  } catch (err) {
    logger.warn("Could not enable lingering (may need root)", { error: errorMessage(err) });
  }

  // Create user systemd directory
  const serviceDir = `${home}/.config/systemd/user`;
  await Bun.write(`${serviceDir}/.keep`, "");

  // Write user service file
  const serviceContent = `[Unit]
Description=Rachel8 AI Assistant
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=120
StartLimitBurst=3

[Service]
Type=simple
WorkingDirectory=${projectDir}
ExecStart=${bunPath} run src/index.ts
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;

  const servicePath = `${serviceDir}/rachel8.service`;
  await Bun.write(servicePath, serviceContent);
  logger.info(`Wrote service file to ${servicePath}`);

  // Set env vars for systemd user bus
  const uid = await getUid();
  const env = {
    ...Bun.env,
    XDG_RUNTIME_DIR: `/run/user/${uid}`,
    DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${uid}/bus`,
  };

  try {
    await run("systemctl", ["--user", "daemon-reload"], env);
    logger.info("Reloaded user systemd daemon");

    await run("systemctl", ["--user", "enable", "rachel8"], env);
    logger.info("Enabled rachel8 service (starts on boot)");

    await run("systemctl", ["--user", "start", "rachel8"], env);
    logger.info("Started rachel8 service");
  } catch (err) {
    logger.error("Failed to install systemd user service", { error: errorMessage(err) });
    console.log("\nTo install manually:");
    console.log(`  loginctl enable-linger ${user}`);
    console.log(`  systemctl --user daemon-reload`);
    console.log("  systemctl --user enable rachel8");
    console.log("  systemctl --user start rachel8");
  }
}

async function getUid(): Promise<string> {
  const proc = Bun.spawn(["id", "-u"], { stdout: "pipe", stderr: "ignore" });
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  return output.trim();
}

async function run(cmd: string, args: string[], env?: Record<string, string | undefined>): Promise<void> {
  const proc = Bun.spawn([cmd, ...args], {
    stdout: "ignore",
    stderr: "pipe",
    ...(env ? { env } : {}),
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Command failed (${cmd} ${args.join(" ")}): ${stderr}`);
  }
}
