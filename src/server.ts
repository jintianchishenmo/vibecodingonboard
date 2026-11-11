import { randomBytes } from "node:crypto";
import { createWriteStream, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { userFromRequest } from "./auth.ts";
import { appUrl, config } from "./config.ts";
import { apps, deployments, type App, type Deployment, type User } from "./db.ts";
import { docker } from "./docker.ts";
import { buildLogTail, containerName, runDeployment } from "./deploy.ts";

const APP_NAME = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const RESERVED = new Set(["api", "www", "admin", "app", "dashboard", "console", "traefik", "mail", "status"]);

class HttpError extends Error {
  status: number;
  code: string;
  extra: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

function deploymentView(d: Deployment) {
  return {
    id: d.id,
    app: d.app_name,
    status: d.status,
    url: appUrl(d.app_name),
    error: d.error,
    created_at: d.created_at,
    finished_at: d.finished_at,
    ...(d.status === "running" ? {} : { build_log_tail: buildLogTail(d.id) }),
  };
}

function appView(a: App) {
  const latest = deployments.latestForApp(a.name);
  return {
    name: a.name,
    url: appUrl(a.name),
    live: a.current_deployment_id !== null,
    latest_deployment: latest ? { id: latest.id, status: latest.status, error: latest.error } : null,
  };
}

function ownedApp(user: User, name: string): App {
  const app = apps.get(name);
  if (!app || app.user_id !== user.id) throw new HttpError(404, "app_not_found", `No app named "${name}" in your account.`);
  return app;
}

async function handleDeploy(req: IncomingMessage, user: User, name: string) {
  if (!APP_NAME.test(name) || RESERVED.has(name)) {
    throw new HttpError(
      400,
      "invalid_app_name",
      "App name must be 3-40 characters of lowercase letters, digits and hyphens, and cannot start or end with a hyphen.",
    );
  }

  const existing = apps.get(name);
  if (existing && existing.user_id !== user.id) {
    throw new HttpError(409, "app_name_taken", `The name "${name}" is taken. Choose another app name.`);
  }
  if (!existing && apps.countByUser(user.id) >= user.app_limit) {
    throw new HttpError(
      402,
      "quota_exceeded",
      `Your plan allows ${user.app_limit} app(s) and you are using all of them. ` +
        `Tell the user to top up or upgrade at ${config.upgradeUrl}, then deploy again.`,
      { upgrade_url: config.upgradeUrl },
    );
  }
  if (existing && deployments.latestForApp(name)?.status === "building") {
    throw new HttpError(409, "deploy_in_progress", "A deployment for this app is already building. Wait for it to finish.");
  }

  // Stream the upload to disk with a size cap.
  const id = "d_" + randomBytes(6).toString("hex");
  const archivePath = join(config.uploadsDir, `${id}.tgz`);
  let received = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      if (received > config.maxUploadBytes) {
        cb(new HttpError(413, "upload_too_large", `Upload is larger than ${config.maxUploadBytes / 1024 / 1024} MB.`));
      } else cb(null, chunk);
    },
  });
  try {
    await pipeline(req, limit, createWriteStream(archivePath));
    if (received === 0) throw new HttpError(400, "empty_upload", "Request body must be a gzipped tar of the project.");
  } catch (err) {
    rmSync(archivePath, { force: true });
    throw err;
  }

  if (!existing) apps.create(name, user.id);
  deployments.create(id, name);
  void runDeployment(id, name, archivePath);

  return deploymentView(deployments.get(id)!);
}

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://local");
  const parts = url.pathname.split("/").filter(Boolean);
  const method = req.method ?? "GET";

  if (method === "GET" && url.pathname === "/healthz") return send(res, 200, { ok: true });
  if (method === "GET" && url.pathname === "/pricing") {
    // Placeholder until the website and payments exist.
    return send(res, 200, { message: "Top-up page coming soon." });
  }

  if (parts[0] !== "v1") throw new HttpError(404, "not_found", "Not found.");
  const user = userFromRequest(req);
  if (!user) throw new HttpError(401, "unauthorized", "Missing or invalid API token.");

  // GET /v1/apps
  if (method === "GET" && parts.length === 2 && parts[1] === "apps") {
    return send(res, 200, { apps: apps.listByUser(user.id).map(appView), app_limit: user.app_limit });
  }
  // GET /v1/apps/:name
  if (method === "GET" && parts.length === 3 && parts[1] === "apps") {
    return send(res, 200, appView(ownedApp(user, parts[2])));
  }
  // POST /v1/apps/:name/deployments
  if (method === "POST" && parts.length === 4 && parts[1] === "apps" && parts[3] === "deployments") {
    return send(res, 202, await handleDeploy(req, user, parts[2]));
  }
  // GET /v1/apps/:name/logs?lines=100
  if (method === "GET" && parts.length === 4 && parts[1] === "apps" && parts[3] === "logs") {
    const app = ownedApp(user, parts[2]);
    if (!app.current_deployment_id) throw new HttpError(409, "not_running", "This app has never started successfully.");
    const lines = Math.min(Math.max(Number(url.searchParams.get("lines")) || 100, 1), 1000);
    const out = await docker(["logs", "--tail", String(lines), containerName(app.name)]);
    return send(res, 200, { app: app.name, lines, logs: out.output });
  }
  // GET /v1/deployments/:id
  if (method === "GET" && parts.length === 3 && parts[1] === "deployments") {
    const d = deployments.get(parts[2]);
    if (!d) throw new HttpError(404, "deployment_not_found", "No such deployment.");
    ownedApp(user, d.app_name);
    return send(res, 200, deploymentView(d));
  }

  throw new HttpError(404, "not_found", "Not found.");
}

createServer((req, res) => {
  route(req, res).catch((err) => {
    if (err instanceof HttpError) return send(res, err.status, { error: err.code, message: err.message, ...err.extra });
    console.error(err);
    send(res, 500, { error: "internal_error", message: "Something went wrong on the platform." });
  });
}).listen(config.apiPort, () => {
  console.log(`landingzone platform API on http://localhost:${config.apiPort}`);
  console.log(`apps served at ${appUrl("<app>")}`);
});
