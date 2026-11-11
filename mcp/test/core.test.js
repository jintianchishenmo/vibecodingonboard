import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getCredential, saveCredential } from "../dist/credentials.js";
import { pickImage } from "../dist/images.js";
import { newKeyPair } from "../dist/keys.js";
import { toAppName } from "../dist/names.js";
import { pickPlan } from "../dist/plans.js";
import { redact } from "../dist/redact.js";
import { deployScript } from "../dist/remote.js";
import { toPublic } from "../dist/state.js";

test("app names stay short and safe", () => {
  assert.equal(toAppName("My App!"), "my-app");
  assert.throws(() => toAppName("---"));
});

test("plan pick chooses the cheapest fit and stays short on failure", () => {
  const plans = [
    { id: "tiny", memoryGiB: 0.5, price: 10, linux: true },
    { id: "a", memoryGiB: 1, price: 30, linux: true },
    { id: "b", memoryGiB: 2, price: 20, linux: true },
    { id: "win", memoryGiB: 8, price: 1, linux: false },
  ];
  assert.equal(pickPlan(plans, "micro").id, "a");
  assert.equal(pickPlan(plans, "small").id, "b");
  assert.throws(() => pickPlan([plans[0]], "small"), /tiny/);
});

test("image pick prefers Ubuntu 24", () => {
  const images = [
    { id: "debian", name: "Debian 12", linux: true, system: true },
    { id: "u22", name: "Ubuntu 22.04", linux: true, system: true },
    { id: "u24", name: "Ubuntu 24.04", linux: true, system: true },
    { id: "app", name: "Ubuntu 22.04 app", linux: true, system: false },
  ];
  assert.equal(pickImage(images).id, "u24");
});

test("credentials round-trip does not return the secret", () => {
  process.env.LANDINGZONE_HOME = mkdtempSync(join(tmpdir(), "lz-"));
  const saved = saveCredential("aws", {
    accessKeyId: "AKIDEXAMPLE",
    accessKeySecret: "super-secret-value",
    region: "ap-southeast-1",
  });
  assert.deepEqual(saved, { provider: "aws", region: "ap-southeast-1" });
  assert.equal(JSON.stringify(saved).includes("super-secret-value"), false);
  assert.equal(getCredential("aws").accessKeySecret, "super-secret-value");
});

test("public server view and logs drop the secret", () => {
  const record = {
    app: "demo",
    provider: "aws",
    region: "ap-southeast-1",
    instanceId: "lz-demo",
    instanceName: "lz-demo",
    ip: "1.2.3.4",
    user: "ubuntu",
    port: 3000,
    auth: "key",
    secret: "BEGIN PRIVATE KEY",
  };
  const pub = toPublic(record);
  assert.equal("secret" in pub, false);
  assert.equal(pub.url, "http://1.2.3.4");
  assert.equal(redact("failed with BEGIN PRIVATE KEY", [record.secret]).includes("BEGIN"), false);
});

test("deploy script uses the port the AI asked for", () => {
  assert.match(deployScript(3000), /-p 80:3000/);
  assert.match(deployScript(8080), /PORT=8080/);
});

test("generated ssh key is openssh", () => {
  const pair = newKeyPair();
  assert.match(pair.publicKey, /^ssh-ed25519 /);
  assert.match(pair.privateKey, /OPENSSH PRIVATE KEY/);
});
