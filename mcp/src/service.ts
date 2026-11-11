import { setTimeout as sleep } from "node:timers/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createAliyun, describeAliyun, destroyAliyun, openAliyunPort } from "./clouds/aliyun.js";
import { createAws, describeAws, destroyAws, openAwsPort } from "./clouds/aws.js";
import { getCredential, resolveProvider, type Credential, type Provider } from "./credentials.js";
import { filesForRuntime, type Runtime } from "./dockerfiles.js";
import { messageOf } from "./errors.js";
import { instanceName } from "./names.js";
import { callerIpv4, waitForTcp } from "./net.js";
import { packProject } from "./pack.js";
import { redact, tail } from "./redact.js";
import { deployScript, logScript } from "./remote.js";
import { sshExec, sshUpload } from "./ssh.js";
import { getServer, listServers, removeServer, saveServer, toPublic, type PublicServer, type ServerRecord } from "./state.js";

const MAX_UPLOAD = 50 * 1024 * 1024;

export type DeployInput = {
  dir: string;
  app: string;
  provider?: Provider;
  region?: string;
  size: "micro" | "small";
  port: number;
  runtime: Runtime;
  publicPorts: number[];
  sshCidr?: string;
};

function regionOf(cred: Credential, region?: string): string {
  const value = region || cred.region;
  if (!value) throw new Error("Pass a region.");
  return value;
}

function hasBuildScript(dir: string): boolean {
  const file = join(dir, "package.json");
  if (!existsSync(file)) return false;
  try {
    return Boolean(JSON.parse(readFileSync(file, "utf8")).scripts?.build);
  } catch {
    throw new Error("package.json is not valid JSON.");
  }
}

async function ensureServer(input: DeployInput, cred: Credential, provider: Provider, region: string): Promise<ServerRecord> {
  const existing = getServer(input.app);
  const name = instanceName(input.app);
  if (existing && existing.provider === provider && existing.region === region) {
    const live = provider === "aws"
      ? await describeAws(cred, region, existing.instanceName)
      : await describeAliyun(cred, region, existing.instanceId);
    if (live?.state === "running" && live.ip) {
      const next = { ...existing, ip: live.ip, port: input.port };
      saveServer(next);
      return next;
    }
    if (live) throw new Error(`Server ${name} is ${live.state} and has no public IP yet. Check status again shortly.`);
  }

  if (provider === "aws") {
    const sshIp = input.sshCidr ?? `${await callerIpv4()}/32`;
    const draft: ServerRecord = {
      app: input.app,
      provider,
      region,
      instanceId: name,
      instanceName: name,
      ip: null,
      user: "ubuntu",
      port: input.port,
      auth: "key",
      secret: "",
    };
    const created = await createAws({
      cred,
      region,
      name,
      app: input.app,
      size: input.size,
      publicPorts: input.publicPorts,
      sshCidr: sshIp,
      track(secret) {
        draft.secret = secret;
        saveServer(draft);
      },
    });
    draft.ip = created.ip;
    draft.user = created.user;
    draft.secret = created.secret;
    saveServer(draft);
    return draft;
  }

  const draft: ServerRecord = {
    app: input.app,
    provider,
    region,
    instanceId: "",
    instanceName: name,
    ip: null,
    user: "root",
    port: input.port,
    auth: "key",
    secret: "",
  };
  const created = await createAliyun({
    cred,
    region,
    name,
    size: input.size,
    publicPorts: input.publicPorts,
    track(secret, instanceId) {
      draft.secret = secret;
      draft.instanceId = instanceId;
      saveServer(draft);
    },
  });
  draft.instanceId = created.instanceId;
  draft.ip = created.ip;
  draft.secret = created.secret;
  saveServer(draft);
  return draft;
}

async function publish(record: ServerRecord, dir: string, runtime: Runtime): Promise<void> {
  if (runtime === "dockerfile" && !existsSync(join(dir, "Dockerfile"))) {
    throw new Error("runtime dockerfile needs a Dockerfile in the project root.");
  }
  if (runtime === "static" && !hasBuildScript(dir) && !existsSync(join(dir, "index.html"))) {
    throw new Error("runtime static needs index.html or a package.json build script.");
  }
  const files = filesForRuntime(runtime, runtime === "static" && hasBuildScript(dir));
  const listen = runtime === "static" ? 80 : record.port;
  const archive = await packProject(dir);
  if (archive.length > MAX_UPLOAD) {
    throw new Error(`Project is ${(archive.length / 1024 / 1024).toFixed(1)} MB after packing (limit 50 MB).`);
  }
  await waitForTcp(record.ip!, 22, 3 * 60 * 1000);
  let last: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await sshUpload(record, "/tmp/lz-app.tgz", archive);
      if (files.dockerfile) await sshUpload(record, "/tmp/lz.Dockerfile", files.dockerfile);
      if (files.nginx) await sshUpload(record, "/tmp/lz.nginx.conf", files.nginx);
      const ran = await sshExec(record, deployScript(listen));
      if (ran.code !== 0 || !/\btrue\b/.test(ran.output)) throw new Error(`Deploy failed.\n${tail(ran.output)}`);
      return;
    } catch (err) {
      last = err;
      if (err instanceof Error && err.message.startsWith("Deploy failed")) throw err;
      await sleep(5000);
    }
  }
  throw last instanceof Error ? last : new Error("SSH deploy failed.");
}

export async function deployApp(input: DeployInput): Promise<string> {
  const ports = [...new Set([80, ...input.publicPorts].filter((port) => port !== 22))];
  const provider = resolveProvider(input.provider);
  const cred = getCredential(provider);
  const region = regionOf(cred, input.region);
  try {
    const record = await ensureServer({ ...input, publicPorts: ports }, cred, provider, region);
    await publish(record, input.dir, input.runtime);
    return `Live at http://${record.ip}`;
  } catch (err) {
    throw new Error(redact(messageOf(err), [cred.accessKeySecret, cred.accessKeyId]));
  }
}

export async function statusApp(app?: string): Promise<PublicServer | PublicServer[]> {
  if (!app) return listServers();
  const record = getServer(app);
  if (!record) throw new Error(`No server stored for "${app}".`);
  const cred = getCredential(record.provider);
  const live = record.provider === "aws"
    ? await describeAws(cred, record.region, record.instanceName)
    : await describeAliyun(cred, record.region, record.instanceId);
  if (!live) return { ...toPublic(record), ip: null, url: null };
  const next = { ...record, ip: live.ip };
  saveServer(next);
  return toPublic(next);
}

export async function logsApp(app: string, lines: number): Promise<string> {
  const record = getServer(app);
  if (!record?.ip) throw new Error(`No running server stored for "${app}".`);
  const ran = await sshExec(record, logScript(lines));
  return tail(redact(ran.output, [record.secret]), lines) || "(no output yet)";
}

export async function openAppPort(app: string, port: number): Promise<string> {
  const record = getServer(app);
  if (!record) throw new Error(`No server stored for "${app}".`);
  const cred = getCredential(record.provider);
  if (record.provider === "aws") await openAwsPort(cred, record.region, record.instanceName, port);
  else await openAliyunPort(cred, record.region, record.instanceId, port);
  return `Opened tcp/${port} on ${app}.`;
}

export async function destroyApp(app: string): Promise<string> {
  const record = getServer(app);
  if (!record) throw new Error(`No server stored for "${app}".`);
  const cred = getCredential(record.provider);
  const note = record.provider === "aws"
    ? await destroyAws(cred, record.region, record.instanceName)
    : await destroyAliyun(cred, record.region, record.instanceId);
  removeServer(app);
  return note;
}
