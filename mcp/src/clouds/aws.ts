import {
  CloseInstancePublicPortsCommand,
  CreateInstancesCommand,
  DeleteInstanceCommand,
  DeleteKeyPairCommand,
  GetBlueprintsCommand,
  GetBundlesCommand,
  GetInstanceCommand,
  GetRegionsCommand,
  ImportKeyPairCommand,
  LightsailClient,
  OpenInstancePublicPortsCommand,
} from "@aws-sdk/client-lightsail";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import type { Credential } from "../credentials.js";
import { isAlready, messageOf } from "../errors.js";
import { pickImage, type ImageChoice } from "../images.js";
import { newKeyPair } from "../keys.js";
import { poll } from "../net.js";
import { pickPlan, type PlanChoice, type Size } from "../plans.js";

function client(cred: Credential, region: string): LightsailClient {
  return new LightsailClient({
    region,
    credentials: { accessKeyId: cred.accessKeyId, secretAccessKey: cred.accessKeySecret },
  });
}

export async function verifyAws(cred: Credential): Promise<string> {
  const sts = new STSClient({
    region: cred.region,
    credentials: { accessKeyId: cred.accessKeyId, secretAccessKey: cred.accessKeySecret },
  });
  const id = await sts.send(new GetCallerIdentityCommand({}));
  return id.Account ?? "aws";
}

async function zoneOf(api: LightsailClient, region: string): Promise<string> {
  const res = await api.send(new GetRegionsCommand({ includeAvailabilityZones: true }));
  const found = res.regions?.find((item) => item.name === region);
  const zone = found?.availabilityZones?.find((item) => item.state === "available")?.zoneName;
  if (!zone) throw new Error(`No availability zone for ${region}.`);
  return zone;
}

async function bundleId(api: LightsailClient, size: Size): Promise<string> {
  const res = await api.send(new GetBundlesCommand({}));
  const plans: PlanChoice[] = (res.bundles ?? [])
    .filter((bundle) => bundle.isActive && bundle.bundleId && (bundle.publicIpv4AddressCount ?? 0) > 0)
    .filter((bundle) => (bundle.supportedPlatforms ?? []).some((platform) => String(platform) === "LINUX_UNIX"))
    .map((bundle) => ({
      id: bundle.bundleId!,
      memoryGiB: bundle.ramSizeInGb ?? 0,
      price: bundle.price ?? 0,
      linux: true,
    }));
  return pickPlan(plans, size).id;
}

async function blueprintId(api: LightsailClient): Promise<string> {
  const res = await api.send(new GetBlueprintsCommand({}));
  const images: ImageChoice[] = (res.blueprints ?? [])
    .filter((blueprint) => blueprint.isActive && blueprint.blueprintId)
    .map((blueprint) => ({
      id: blueprint.blueprintId!,
      name: `${blueprint.blueprintId} ${blueprint.name ?? ""}`,
      linux: String(blueprint.platform) !== "WINDOWS",
      system: String(blueprint.type) === "os",
    }));
  return pickImage(images).id;
}

async function replaceKey(api: LightsailClient, name: string, publicKey: string): Promise<void> {
  try {
    await api.send(new DeleteKeyPairCommand({ keyPairName: name }));
  } catch {
    // A missing key is the normal first-time case.
  }
  await api.send(
    new ImportKeyPairCommand({
      keyPairName: name,
      publicKeyBase64: Buffer.from(publicKey).toString("base64"),
    }),
  );
}

type Live = { state: string; ip: string | null; user: string };

async function lookup(api: LightsailClient, name: string): Promise<Live | null> {
  try {
    const res = await api.send(new GetInstanceCommand({ instanceName: name }));
    const inst = res.instance;
    if (!inst) return null;
    return { state: inst.state?.name ?? "pending", ip: inst.publicIpAddress ?? null, user: inst.username || "ubuntu" };
  } catch (err) {
    if (/notfound|not found|does not exist/i.test(messageOf(err))) return null;
    throw err;
  }
}

async function openPort(api: LightsailClient, name: string, port: number, cidr: string): Promise<void> {
  try {
    await api.send(
      new OpenInstancePublicPortsCommand({
        instanceName: name,
        portInfo: { fromPort: port, toPort: port, protocol: "tcp", cidrs: [cidr] },
      }),
    );
  } catch (err) {
    if (!isAlready(err)) throw err;
  }
}

export async function openAwsPort(cred: Credential, region: string, name: string, port: number): Promise<void> {
  await openPort(client(cred, region), name, port, "0.0.0.0/0");
}

export async function describeAws(cred: Credential, region: string, name: string): Promise<Live | null> {
  return lookup(client(cred, region), name);
}

export async function destroyAws(cred: Credential, region: string, name: string): Promise<string> {
  const api = client(cred, region);
  await api.send(new DeleteInstanceCommand({ instanceName: name, forceDeleteAddOns: true }));
  try {
    await api.send(new DeleteKeyPairCommand({ keyPairName: name }));
  } catch {
    // The instance delete is what stops the bill.
  }
  return "Deleted the Lightsail instance.";
}

export async function createAws(input: {
  cred: Credential;
  region: string;
  name: string;
  app: string;
  size: Size;
  publicPorts: number[];
  sshCidr: string;
  track?: (secret: string) => void;
}): Promise<{ ip: string; user: string; secret: string }> {
  const api = client(input.cred, input.region);
  const keys = newKeyPair();
  await replaceKey(api, input.name, keys.publicKey);
  await api.send(
    new CreateInstancesCommand({
      instanceNames: [input.name],
      availabilityZone: await zoneOf(api, input.region),
      blueprintId: await blueprintId(api),
      bundleId: await bundleId(api, input.size),
      keyPairName: input.name,
      ipAddressType: "ipv4",
      tags: [{ key: "landingzone", value: input.app }],
    }),
  );
  input.track?.(keys.privateKey);
  const ready = await poll(async () => {
    const live = await lookup(api, input.name);
    return live?.state === "running" && live.ip ? live : null;
  }, 4 * 60 * 1000);
  try {
    await api.send(
      new CloseInstancePublicPortsCommand({
        instanceName: input.name,
        portInfo: { fromPort: 22, toPort: 22, protocol: "tcp" },
      }),
    );
  } catch {
    // Port 22 may not be open yet. The next call opens it for this computer only.
  }
  await openPort(api, input.name, 22, input.sshCidr);
  for (const port of input.publicPorts) await openPort(api, input.name, port, "0.0.0.0/0");
  return { ip: ready.ip!, user: ready.user, secret: keys.privateKey };
}
