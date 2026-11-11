#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { verifyAliyun } from "./clouds/aliyun.js";
import { verifyAws } from "./clouds/aws.js";
import { saveCredential, type Provider } from "./credentials.js";
import { messageOf } from "./errors.js";
import { toAppName } from "./names.js";
import { redact } from "./redact.js";
import { deployApp, destroyApp, logsApp, openAppPort, statusApp } from "./service.js";

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }],
});
const fail = (message: string) => ({ ...text(message), isError: true });

async function guarded(fn: () => Promise<unknown>) {
  try {
    return text(await fn());
  } catch (err) {
    return fail(redact(messageOf(err), []));
  }
}

const provider = z.enum(["aws", "aliyun"]);
const server = new McpServer({ name: "landingzone", version: "0.2.0" });

server.registerTool(
  "set_credentials",
  {
    title: "Store cloud credentials",
    description:
      "Store an AWS or Aliyun access key on this computer. Returns {provider, region, account} and does not echo the secret.",
    inputSchema: {
      provider,
      access_key_id: z.string(),
      access_key_secret: z.string(),
      region: z.string().describe("Default region, such as ap-southeast-1 or cn-hongkong."),
    },
  },
  ({ provider: name, access_key_id, access_key_secret, region }) =>
    guarded(async () => {
      const cred = { accessKeyId: access_key_id.trim(), accessKeySecret: access_key_secret.trim(), region: region.trim() };
      const account = name === "aws" ? await verifyAws(cred) : await verifyAliyun(cred);
      const saved = saveCredential(name as Provider, cred);
      return { ...saved, account };
    }),
);

server.registerTool(
  "deploy",
  {
    title: "Deploy to the user's cloud",
    description:
      "Create or reuse one small server in the user's AWS Lightsail or Aliyun lightweight account and run this folder. " +
      "Returns a URL or a short error log. AWS is billed hourly. Aliyun lightweight is prepaid for one month and opens ports 22, 80 and 443 by default.",
    inputSchema: {
      path: z.string().describe("Absolute path of the project folder."),
      runtime: z.enum(["dockerfile", "node", "static"]).describe("How to run it. The AI chooses this."),
      port: z.number().int().describe("Port the app listens on. Use 80 for static."),
      region: z.string().optional().describe("Cloud region. Defaults to the stored region."),
      provider: provider.optional(),
      name: z.string().optional().describe("App name. Defaults to the folder name."),
      size: z.enum(["micro", "small"]).optional().describe("micro is about 1 GiB, small about 2 GiB."),
      public_ports: z.array(z.number().int()).optional().describe("Extra TCP ports to open. 80 is always opened."),
      ssh_cidr: z.string().optional().describe("AWS SSH allowlist. Defaults to this computer's public IP /32."),
    },
  },
  (input) =>
    guarded(async () => {
      const dir = resolve(input.path);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`Folder not found: ${dir}`);
      return deployApp({
        dir,
        app: toAppName(input.name ?? basename(dir)),
        provider: input.provider,
        region: input.region,
        size: input.size ?? "micro",
        port: input.runtime === "static" ? 80 : input.port,
        runtime: input.runtime,
        publicPorts: input.public_ports ?? [],
        sshCidr: input.ssh_cidr,
      });
    }),
);

server.registerTool(
  "status",
  {
    title: "Server status",
    description: "Show one app's ip and url, or list stored apps when name is omitted.",
    inputSchema: { name: z.string().optional() },
  },
  ({ name }) => guarded(() => statusApp(name ? toAppName(name) : undefined)),
);

server.registerTool(
  "logs",
  {
    title: "App logs",
    description: "Last lines from the running container.",
    inputSchema: {
      name: z.string(),
      lines: z.number().int().min(1).max(200).optional(),
    },
  },
  ({ name, lines }) => guarded(() => logsApp(toAppName(name), lines ?? 40)),
);

server.registerTool(
  "open_port",
  {
    title: "Open a port",
    description: "Open one TCP port on the app server's firewall.",
    inputSchema: { name: z.string(), port: z.number().int().min(1).max(65535) },
  },
  ({ name, port }) => guarded(() => openAppPort(toAppName(name), port)),
);

server.registerTool(
  "destroy",
  {
    title: "Destroy the server",
    description: "Delete the AWS instance, or stop the Aliyun instance. Aliyun prepaid charges are not refunded here.",
    inputSchema: { name: z.string() },
  },
  ({ name }) => guarded(() => destroyApp(toAppName(name))),
);

await server.connect(new StdioServerTransport());
