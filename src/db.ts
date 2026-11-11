import { DatabaseSync } from "node:sqlite";
import { config } from "./config.ts";

export type User = { id: number; email: string; app_limit: number };
export type App = { name: string; user_id: number; current_deployment_id: string | null; created_at: string };
export type DeploymentStatus = "building" | "running" | "failed";
export type Deployment = {
  id: string;
  app_name: string;
  status: DeploymentStatus;
  error: string | null;
  created_at: string;
  finished_at: string | null;
};

export const db = new DatabaseSync(config.dbFile);

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    token_hash TEXT NOT NULL UNIQUE,
    app_limit INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS apps (
    name TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    current_deployment_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS deployments (
    id TEXT PRIMARY KEY,
    app_name TEXT NOT NULL REFERENCES apps(name),
    status TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT
  );
`);

// Builds run inside this process, so any build still marked "building" at startup was cut off.
db.prepare(
  `UPDATE deployments SET status = 'failed', error = 'Interrupted by a platform restart. Deploy again.',
   finished_at = datetime('now') WHERE status = 'building'`,
).run();

export const users = {
  byTokenHash: (hash: string) =>
    db.prepare("SELECT id, email, app_limit FROM users WHERE token_hash = ?").get(hash) as User | undefined,
  create: (email: string, tokenHash: string, appLimit: number) =>
    db.prepare("INSERT INTO users (email, token_hash, app_limit) VALUES (?, ?, ?)").run(email, tokenHash, appLimit),
};

export const apps = {
  get: (name: string) => db.prepare("SELECT * FROM apps WHERE name = ?").get(name) as App | undefined,
  listByUser: (userId: number) =>
    db.prepare("SELECT * FROM apps WHERE user_id = ? ORDER BY created_at").all(userId) as App[],
  countByUser: (userId: number) =>
    (db.prepare("SELECT COUNT(*) AS n FROM apps WHERE user_id = ?").get(userId) as { n: number }).n,
  create: (name: string, userId: number) =>
    db.prepare("INSERT INTO apps (name, user_id) VALUES (?, ?)").run(name, userId),
  setCurrent: (name: string, deploymentId: string) =>
    db.prepare("UPDATE apps SET current_deployment_id = ? WHERE name = ?").run(deploymentId, name),
};

export const deployments = {
  get: (id: string) => db.prepare("SELECT * FROM deployments WHERE id = ?").get(id) as Deployment | undefined,
  latestForApp: (app: string) =>
    db.prepare("SELECT * FROM deployments WHERE app_name = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(app) as
      | Deployment
      | undefined,
  create: (id: string, app: string) =>
    db.prepare("INSERT INTO deployments (id, app_name, status) VALUES (?, ?, 'building')").run(id, app),
  finish: (id: string, status: DeploymentStatus, error: string | null) =>
    db.prepare("UPDATE deployments SET status = ?, error = ?, finished_at = datetime('now') WHERE id = ?").run(
      status,
      error,
      id,
    ),
};
