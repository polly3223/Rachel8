export function commandArg(text: string | undefined): string | undefined {
  const parts = (text ?? "").trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : undefined;
}
