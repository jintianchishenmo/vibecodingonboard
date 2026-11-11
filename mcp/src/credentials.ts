import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { landingFile, lockDown } from "./home.js";

export type Provider = "aws" | "aliyun";

export type Credential = {
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
};

type FileShape = Partial<Record<Provider, Credential>>;

function path(): string {
  return landingFile("credentials.json");
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

export function listProviders(): Provider[] {
  const data = readFile();
  return (["aws", "aliyun"] as const).filter((provider) => data[provider]);
}

export function getCredential(provider: Provider): Credential {
  const cred = readFile()[provider];
  if (!cred?.accessKeyId || !cred.accessKeySecret) {
    throw new Error(`No ${provider} credentials stored. Call set_credentials first.`);
  }
  return cred;
}

/** Writes the key locally. The return value has no secret. */
export function saveCredential(provider: Provider, cred: Credential): { provider: Provider; region: string } {
  const data = readFile();
  data[provider] = cred;
  writeFile(data);
  return { provider, region: cred.region };
}

export function resolveProvider(requested?: Provider): Provider {
  if (requested) return requested;
  const stored = (["aws", "aliyun"] as const).filter((provider) => readFile()[provider]);
  if (stored.length === 1) return stored[0];
  if (stored.length === 0) throw new Error("No cloud credentials stored. Call set_credentials first.");
  throw new Error("More than one cloud is stored. Pass provider aws or aliyun.");
}
