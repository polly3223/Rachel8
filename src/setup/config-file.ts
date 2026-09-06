/** Preserve comments and settings not managed by the wizard. Values are dotenv-quoted. */
export function mergeEnv(existing: string, updates: Record<string, string>): string {
  const remaining = new Map(Object.entries(updates));
  const lines = existing.split(/\r?\n/).map((line) => {
    const key = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
    if (!key || !remaining.has(key)) return line;
    const value = remaining.get(key)!;
    remaining.delete(key);
    return `${key}=${JSON.stringify(value)}`;
  });
  return (
    [...lines, ...[...remaining].map(([key, value]) => `${key}=${JSON.stringify(value)}`)]
      .join("\n")
      .trim() + "\n"
  );
}
