import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { x as extractTar } from "tar";
import { appHost, config } from "./config.ts";
import { apps, deployments } from "./db.ts";
import { docker } from "./docker.ts";
import { prepareBuild, ProjectError } from "./detect.ts";

export const containerName = (app: string) => `lz-app-${app}`;
export const buildLogPath = (deploymentId: string) => join(config.logsDir, `${deploymentId}.log`);

export function buildLogTail(deploymentId: string, lines = 60): string {
  const path = buildLogPath(deploymentId);
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8").split("\n").slice(-lines).join("\n");
}

/** Extracts, builds and starts one deployment. Runs in the background; the result is written to the database. */
export async function runDeployment(deploymentId: string, app: string, archivePath: string): Promise<void> {
  const workDir = join(config.buildsDir, deploymentId);
  const log = createWriteStream(buildLogPath(deploymentId));
  const step = (msg: string) => log.write(`\n==> ${msg}\n`);

  try {
    step("Unpacking upload");
    mkdirSync(workDir, { recursive: true });
    // tar refuses absolute paths and ".." entries by default, so uploads cannot write outside workDir.
    await extractTar({ file: archivePath, cwd: workDir });

    const plan = prepareBuild(workDir);
    step(`Detected project type: ${plan.kind} (app port ${plan.port})`);

    const image = `lz-app-${app}:${deploymentId}`;
    step(`Building image ${image}`);
    const build = await docker(["build", "--progress=plain", "-t", image, "--label", `lz.app=${app}`, workDir], log);
    if (build.code !== 0) throw new ProjectError("Build failed. See the build log below.");

    step("Starting container");
    const name = containerName(app);
    await docker(["rm", "-f", name]);
    const run = await docker(
      [
        "run", "-d",
        "--name", name,
        "--network", config.dockerNetwork,
        "--restart", "unless-stopped",
        "--memory", config.appMemory,
        "--cpus", config.appCpus,
        "--pids-limit", "256",
        "--security-opt", "no-new-privileges",
        "-e", `PORT=${plan.port}`,
        "--label", `lz.app=${app}`,
        "--label", "traefik.enable=true",
        "--label", `traefik.http.routers.${app}.rule=Host(\`${appHost(app)}\`)`,
        "--label", `traefik.http.routers.${app}.entrypoints=web`,
        "--label", `traefik.http.services.${app}.loadbalancer.server.port=${plan.port}`,
        image,
      ],
      log,
    );
    if (run.code !== 0) throw new Error(`docker run failed: ${run.output.trim()}`);

    // Catch apps that crash right after starting (missing env var, wrong port, etc.).
    await sleep(4000);
    const state = await docker(["inspect", "-f", "{{.State.Running}} {{.RestartCount}}", name]);
    const [running, restarts] = state.output.trim().split(" ");
    if (running !== "true" || Number(restarts) > 0) {
      const logs = await docker(["logs", "--tail", "40", name]);
      log.write(`\n==> App output\n${logs.output}`);
      await docker(["rm", "-f", name]); // stop the restart loop from eating server resources
      throw new ProjectError("The app crashed right after starting. See the app output below.");
    }

    step("Running");
    deployments.finish(deploymentId, "running", null);
    apps.setCurrent(app, deploymentId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    step(`FAILED: ${message}`);
    deployments.finish(deploymentId, "failed", message);
  } finally {
    log.end();
    rmSync(workDir, { recursive: true, force: true });
    rmSync(archivePath, { force: true });
  }
}
