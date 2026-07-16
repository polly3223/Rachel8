const delaySeconds = Number(Bun.env["RACHEL_RESTART_DELAY_SECONDS"] ?? "60");

if (!Number.isInteger(delaySeconds) || delaySeconds < 1 || delaySeconds > 600) {
  throw new Error("RACHEL_RESTART_DELAY_SECONDS must be an integer from 1 to 600");
}

const unitName = `rachel8-delayed-restart-${Date.now()}`;
const process = Bun.spawn(
  [
    "systemd-run",
    "--user",
    `--unit=${unitName}`,
    `--on-active=${delaySeconds}s`,
    "/usr/bin/systemctl",
    "--user",
    "restart",
    "rachel8",
  ],
  { stdout: "pipe", stderr: "pipe" },
);

const [stdout, stderr, exitCode] = await Promise.all([
  new Response(process.stdout).text(),
  new Response(process.stderr).text(),
  process.exited,
]);

if (exitCode !== 0) {
  throw new Error(stderr.trim() || `systemd-run exited with code ${exitCode}`);
}

console.log(stdout.trim() || `Scheduled ${unitName} in ${delaySeconds} seconds`);
