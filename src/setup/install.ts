import { resolve } from "node:path";
import { logger } from "../lib/logger.ts";
import { errorMessage } from "../lib/errors.ts";

export async function installSystemdService(): Promise<void> {
  const projectDir = resolve(import.meta.dir, "..", "..");
  const templatePath = `${projectDir}/rachel8.service`;

  // Read the template
  const templateFile = Bun.file(templatePath);
  if (!(await templateFile.exists())) {
    throw new Error(
      `Service template not found at ${templatePath}. Re-clone the repository.`,
    );
  }

  let template = await templateFile.text();

  const user = Bun.env["USER"] ?? "root";
  const home = Bun.env["HOME"] ?? `/home/${user}`;
  const standardBunPath = `${home}/.bun/bin/bun`;

  let bunPath = standardBunPath;
  if (!(await Bun.file(standardBunPath).exists())) {
    bunPath = Bun.which("bun") ?? standardBunPath;
  }

  // Replace placeholders
  template = template.replaceAll("__USER__", user);
  template = template.replaceAll("__WORKING_DIR__", projectDir);
  template = template.replaceAll("__BUN_PATH__", bunPath);

  // Check systemd version for RestartSteps support
  await checkSystemdVersion();

  // Write to temp file, then sudo copy
  const tmpPath = "/tmp/rachel8.service";
  await Bun.write(tmpPath, template);

  logger.info("Installing systemd service...");

  try {
    await run("sudo", ["cp", tmpPath, "/etc/systemd/system/rachel8.service"]);
    logger.info("Copied service file to /etc/systemd/system/");

    await run("sudo", ["systemctl", "daemon-reload"]);
    logger.info("Reloaded systemd daemon");

    await run("sudo", ["systemctl", "enable", "rachel8"]);
    logger.info("Enabled rachel8 service (starts on boot)");

    await run("sudo", ["systemctl", "start", "rachel8"]);
    logger.info("Started rachel8 service");
  } catch (err) {
    logger.error("Failed to install systemd service", { error: errorMessage(err) });
    console.log("\nTo install manually:");
    console.log(`  sudo cp ${tmpPath} /etc/systemd/system/rachel8.service`);
    console.log("  sudo systemctl daemon-reload");
    console.log("  sudo systemctl enable rachel8");
    console.log("  sudo systemctl start rachel8");
  }
}

async function checkSystemdVersion(): Promise<void> {
  try {
    const proc = Bun.spawn(["systemctl", "--version"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;

    const match = output.match(/systemd\s+(\d+)/);
    if (match?.[1]) {
      const version = parseInt(match[1], 10);
      if (version < 254) {
        logger.warn(
          `systemd ${version} detected. RestartSteps requires 254+. ` +
            "Exponential backoff will fall back to fixed-interval restart.",
        );
      }
    }
  } catch {
    // systemctl not available (e.g., macOS dev machine) -- skip check
    logger.debug("Could not detect systemd version (non-Linux system?)");
  }
}

async function run(cmd: string, args: string[]): Promise<void> {
  const proc = Bun.spawn([cmd, ...args], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Command failed (${cmd} ${args.join(" ")}): ${stderr}`);
  }
}
