import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Provider } from "./credentials.js";
import { landingFile, lockDown } from "./home.js";

export type ServerRecord = {
  app: string;
  provider: Provider;
  region: string;
  instanceId: string;
  instanceName: string;
  ip: string | null;
  user: string;
  port: number;
  auth: "key" | "password";
  /** Private key PEM or the server password. Never returned by a tool. */
  secret: string;
};

type FileShape = Record<string, ServerRecord>;

function path(): string {
  return landingFile("servers.json");
}

function readFile(): FileShape {
  const file = path();
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8")) as FileShape;
}

function writeFile(data: FileShape): void {
  const file = path();
  writeFileSync(file, JSON.stringify(data, null, 2));
  lockDown(file);
}

export type PublicServer = Omit<ServerRecord, "secret" | "auth"> & { url: string | null };

export function toPublic(record: ServerRecord): PublicServer {
  const { secret: _secret, auth: _auth, ...rest } = record;
  return { ...rest, url: record.ip ? `http://${record.ip}` : null };
}

export function listServers(): PublicServer[] {
  return Object.values(readFile()).map(toPublic);
}

export function getServer(app: string): ServerRecord | undefined {
  return readFile()[app];
}

export function saveServer(record: ServerRecord): void {
  const data = readFile();
  data[record.app] = record;
  writeFile(data);
}

export function removeServer(app: string): void {
  const data = readFile();
  delete data[app];
  writeFile(data);
}
