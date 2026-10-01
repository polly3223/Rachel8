import { createInterface } from "node:readline";

// Synthetic provider: input uses ASCII; output exercises real UTF-8 pipe boundaries.
createInterface({ input: process.stdin }).on("line", async (line) => {
  const { id, method } = JSON.parse(line) as { id?: number; method: string };
  if (method === "initialize") console.log(JSON.stringify({ id, result: {} }));
  if (method === "unicode") {
    const frame = Buffer.from(
      JSON.stringify({ method: "note", params: "before\u2028middle\u2029after" }) +
        "\r\n" +
        JSON.stringify({ id, result: "é🙂\u2028\u2029".repeat(100_000) }) +
        "\n",
    );
    // Split both Unicode separators mid-codepoint, then stream a large response.
    const boundaries = ["\u2028", "\u2029"].flatMap((separator) => {
      const offset = frame.indexOf(separator);
      return [offset + 1, offset + 2];
    });
    let start = 0;
    for (const end of [...boundaries, frame.length]) {
      process.stdout.write(frame.subarray(start, end));
      start = end;
      await Bun.sleep(2);
    }
  }
  if (method === "invalid") process.stdout.write('{"secret":"do-not-expose",\n');
  if (method === "event") console.log(JSON.stringify({ method: "note", params: {} }));
});
