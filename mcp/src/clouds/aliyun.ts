import { createRequire } from "node:module";
import { $OpenApiUtil } from "@alicloud/openapi-core";
import { randomBytes } from "node:crypto";
import type { Credential } from "../credentials.js";
import { isAlready, messageOf } from "../errors.js";
import { pickImage, type ImageChoice } from "../images.js";
import { newKeyPair } from "../keys.js";
import { poll } from "../net.js";
import { pickPlan, type PlanChoice, type Size } from "../plans.js";

const require = createRequire(import.meta.url);

type Req = Record<string, unknown>;
type Ctor = new (args: Req) => unknown;

interface ImageRow {
  imageId?: string;
  imageName?: string;
  platform?: string;
  imageType?: string;
}
interface PlanRow {
  planId?: string;
  memory?: number;
  originPrice?: string;
  supportPlatform?: string;
}
interface InstanceRow {
  status?: string;
  publicIpAddress?: string;
}
interface SwasClient {
  listPlans(request: unknown): Promise<{ body?: { plans?: PlanRow[] } }>;
  listImages(request: unknown): Promise<{ body?: { images?: ImageRow[] } }>;
  listInstances(request: unknown): Promise<{ body?: { instances?: InstanceRow[] } }>;
  importKeyPair(request: unknown): Promise<unknown>;
  deleteKeyPairs(request: unknown): Promise<unknown>;
  createInstances(request: unknown): Promise<{ body?: { instanceIds?: string[] } }>;
  attachKeyPair(request: unknown): Promise<{ body?: { failCount?: number; results?: Array<{ message?: string }> } }>;
  updateInstanceAttribute(request: unknown): Promise<unknown>;
  rebootInstance(request: unknown): Promise<unknown>;
  createFirewallRule(request: unknown): Promise<unknown>;
  stopInstance(request: unknown): Promise<unknown>;
}

const sdk = require("@alicloud/swas-open20200601") as {
  default: new (config: InstanceType<typeof $OpenApiUtil.Config>) => SwasClient;
  AttachKeyPairRequest: Ctor;
  CreateFirewallRuleRequest: Ctor;
  CreateInstancesRequest: Ctor;
  DeleteKeyPairsRequest: Ctor;
  ImportKeyPairRequest: Ctor;
  ListImagesRequest: Ctor;
  ListInstancesRequest: Ctor;
  ListPlansRequest: Ctor;
  RebootInstanceRequest: Ctor;
  StopInstanceRequest: Ctor;
  UpdateInstanceAttributeRequest: Ctor;
};

const {
  AttachKeyPairRequest,
  CreateFirewallRuleRequest,
  CreateInstancesRequest,
  DeleteKeyPairsRequest,
  ImportKeyPairRequest,
  ListImagesRequest,
  ListInstancesRequest,
  ListPlansRequest,
  RebootInstanceRequest,
  StopInstanceRequest,
  UpdateInstanceAttributeRequest,
} = sdk;

function client(cred: Credential, region: string): SwasClient {
  return new sdk.default(
    new $OpenApiUtil.Config({
      accessKeyId: cred.accessKeyId,
      accessKeySecret: cred.accessKeySecret,
      regionId: region,
      endpoint: `swas.${region}.aliyuncs.com`,
    }),
  );
}

function token(): string {
  return randomBytes(12).toString("hex");
}

export async function verifyAliyun(cred: Credential): Promise<string> {
  await client(cred, cred.region).listPlans(new ListPlansRequest({ regionId: cred.region }));
  return "verified";
}

async function imageId(api: SwasClient, region: string): Promise<string> {
  const res = await api.listImages(new ListImagesRequest({ regionId: region, imageType: "system" }));
  const images: ImageChoice[] = (res.body?.images ?? []).map((image) => ({
    id: image.imageId ?? "",
    name: image.imageName ?? "",
    linux: image.platform === "Linux",
    system: image.imageType === "system",
  }));
  return pickImage(images).id;
}

async function planId(api: SwasClient, region: string, size: Size): Promise<string> {
  const res = await api.listPlans(new ListPlansRequest({ regionId: region }));
  const plans: PlanChoice[] = (res.body?.plans ?? []).map((plan) => ({
    id: plan.planId ?? "",
    memoryGiB: plan.memory ?? 0,
    price: Number(plan.originPrice ?? 0),
    linux: (plan.supportPlatform ?? "").includes("Linux"),
  }));
  return pickPlan(plans.filter((plan) => plan.id), size).id;
}

async function importKey(api: SwasClient, region: string, name: string, publicKey: string): Promise<void> {
  const request = () =>
    api.importKeyPair(
      new ImportKeyPairRequest({ regionId: region, keyPairName: name, publicKeyBody: publicKey, clientToken: token() }),
    );
  try {
    await request();
  } catch (err) {
    if (!isAlready(err)) throw err;
    await api.deleteKeyPairs(new DeleteKeyPairsRequest({ regionId: region, keyPairNames: [name] }));
    await request();
  }
}

type Live = { state: string; ip: string | null };

async function lookup(api: SwasClient, region: string, instanceId: string): Promise<Live | null> {
  const res = await api.listInstances(
    new ListInstancesRequest({ regionId: region, instanceIds: JSON.stringify([instanceId]) }),
  );
  const inst = res.body?.instances?.[0];
  if (!inst) return null;
  return { state: (inst.status ?? "pending").toLowerCase(), ip: inst.publicIpAddress ?? null };
}

async function allow(api: SwasClient, region: string, instanceId: string, port: number): Promise<void> {
  try {
    await api.createFirewallRule(
      new CreateFirewallRuleRequest({
        regionId: region,
        instanceId,
        ruleProtocol: "TCP",
        port: `${port}/${port}`,
        clientToken: token(),
      }),
    );
  } catch (err) {
    if (!isAlready(err)) throw err;
  }
}

export async function openAliyunPort(cred: Credential, region: string, instanceId: string, port: number): Promise<void> {
  await allow(client(cred, region), region, instanceId, port);
}

export async function describeAliyun(cred: Credential, region: string, instanceId: string): Promise<Live | null> {
  try {
    return await lookup(client(cred, region), region, instanceId);
  } catch (err) {
    if (/not found|does not exist|InvalidInstanceId/i.test(messageOf(err))) return null;
    throw err;
  }
}

export async function destroyAliyun(cred: Credential, region: string, instanceId: string): Promise<string> {
  await client(cred, region).stopInstance(new StopInstanceRequest({ regionId: region, instanceId }));
  return "Stopped the server. Aliyun lightweight servers are prepaid, so this does not refund the month. Release it in the Aliyun console to stop the charge.";
}

export async function createAliyun(input: {
  cred: Credential;
  region: string;
  name: string;
  size: Size;
  publicPorts: number[];
  track?: (secret: string, instanceId: string) => void;
}): Promise<{ instanceId: string; ip: string; secret: string }> {
  const api = client(input.cred, input.region);
  const keys = newKeyPair();
  await importKey(api, input.region, input.name, keys.publicKey);
  const created = await api.createInstances(
    new CreateInstancesRequest({
      regionId: input.region,
      imageId: await imageId(api, input.region),
      planId: await planId(api, input.region, input.size),
      period: 1,
      amount: 1,
      autoRenew: false,
      clientToken: token(),
    }),
  );
  const instanceId = created.body?.instanceIds?.[0];
  if (!instanceId) throw new Error("Aliyun did not return an instance id.");
  input.track?.(keys.privateKey, instanceId);
  const ready = await poll(async () => {
    const live = await lookup(api, input.region, instanceId);
    return live?.state === "running" && live.ip ? live : null;
  }, 4 * 60 * 1000);
  const attached = await api.attachKeyPair(
    new AttachKeyPairRequest({
      regionId: input.region,
      keyPairName: input.name,
      instanceIds: [instanceId],
      clientToken: token(),
    }),
  );
  if ((attached.body?.failCount ?? 0) > 0) {
    const why = (attached.body?.results ?? []).map((item) => item.message).filter(Boolean).join("; ");
    throw new Error(why || "Could not attach the SSH key.");
  }
  await api.updateInstanceAttribute(
    new UpdateInstanceAttributeRequest({ regionId: input.region, instanceId, instanceName: input.name }),
  );
  try {
    await api.rebootInstance(new RebootInstanceRequest({ regionId: input.region, instanceId }));
  } catch (err) {
    if (!/reboot|status/i.test(messageOf(err))) throw err;
  }
  await poll(async () => {
    const live = await lookup(api, input.region, instanceId);
    return live?.state === "running" && live.ip ? live : null;
  }, 4 * 60 * 1000);
  for (const port of input.publicPorts) await allow(api, input.region, instanceId, port);
  return { instanceId, ip: ready.ip!, secret: keys.privateKey };
}
