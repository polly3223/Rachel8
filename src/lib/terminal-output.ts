const ANSI_RE = new RegExp(
  "[\\u001B\\u009B][[\\]()#;?]*(?:(?:[a-zA-Z\\d]*(?:;[a-zA-Z\\d]*)*)?\\u0007|(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~])",
  "g",
);

export function cleanTerminalOutput(text: string): string {
  return text
    .replace(ANSI_RE, "")
    .replace(/\r/g, "")
    .replace(/\u0008/g, "")
    .replace(/\^D/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function outputTail(text: string, lines = 8): string {
  return cleanTerminalOutput(text).split("\n").slice(-lines).join("\n").trim();
}
