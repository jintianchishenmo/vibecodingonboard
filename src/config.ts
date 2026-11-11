import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const env = process.env;

const dataDir = resolve(env.LZ_DATA_DIR ?? "data");

export const config = {
  apiPort: Number(env.LZ_API_PORT ?? 8787),
  appsDomain: env.LZ_APPS_DOMAIN ?? "localhost",
  publicScheme: env.LZ_PUBLIC_SCHEME ?? "http",
  publicPort: env.LZ_PUBLIC_PORT ?? "80",
  dockerNetwork: "lz-net",
  upgradeUrl: env.LZ_UPGRADE_URL ?? "http://localhost:8787/pricing",
  appMemory: env.LZ_APP_MEMORY ?? "512m",
  appCpus: env.LZ_APP_CPUS ?? "0.25",
  maxUploadBytes: Number(env.LZ_MAX_UPLOAD_MB ?? 50) * 1024 * 1024,
  dbFile: join(dataDir, "platform.db"),
  uploadsDir: join(dataDir, "uploads"),
  buildsDir: join(dataDir, "builds"),
  logsDir: join(dataDir, "logs"),
};

for (const dir of [dataDir, config.uploadsDir, config.buildsDir, config.logsDir]) {
  mkdirSync(dir, { recursive: true });
}

export function appHost(name: string): string {
  return `${name}.${config.appsDomain}`;
}

export function appUrl(name: string): string {
  const defaultPort = config.publicScheme === "https" ? "443" : "80";
  const port = config.publicPort === defaultPort ? "" : `:${config.publicPort}`;
  return `${config.publicScheme}://${appHost(name)}${port}`;
}
