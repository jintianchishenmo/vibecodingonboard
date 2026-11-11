import { Client } from "ssh2";
import type { ServerRecord } from "./state.js";

export type SshAuth = Pick<ServerRecord, "ip" | "user" | "auth" | "secret">;

function connect(auth: SshAuth): Promise<Client> {
  return new Promise((resolve, reject) => {
    if (!auth.ip) {
      reject(new Error("Server has no public IP yet."));
      return;
    }
    const client = new Client();
    client.once("ready", () => resolve(client));
    client.once("error", reject);
    client.connect({
      host: auth.ip,
      port: 22,
      username: auth.user,
      readyTimeout: 20000,
      ...(auth.auth === "key" ? { privateKey: auth.secret } : { password: auth.secret }),
    });
  });
}

export async function sshExec(auth: SshAuth, command: string): Promise<{ code: number; output: string }> {
  const client = await connect(auth);
  try {
    return await new Promise((resolve, reject) => {
      client.exec(command, (err, stream) => {
        if (err || !stream) {
          reject(err ?? new Error("SSH exec failed."));
          return;
        }
        let output = "";
        const collect = (chunk: Buffer) => {
          output = (output + chunk.toString()).slice(-64 * 1024);
        };
        stream.on("data", collect);
        stream.stderr.on("data", collect);
        stream.on("close", (code: number | null) => resolve({ code: code ?? 1, output }));
        stream.on("error", reject);
      });
    });
  } finally {
    client.end();
  }
}

export async function sshUpload(auth: SshAuth, remote: string, body: Buffer | string): Promise<void> {
  const client = await connect(auth);
  try {
    const sftp = await new Promise<import("ssh2").SFTPWrapper>((resolve, reject) => {
      client.sftp((err, wrapper) => (err || !wrapper ? reject(err ?? new Error("SFTP failed.")) : resolve(wrapper)));
    });
    await new Promise<void>((resolve, reject) => {
      const stream = sftp.createWriteStream(remote);
      stream.on("error", reject);
      stream.on("close", () => resolve());
      stream.end(body);
    });
  } finally {
    client.end();
  }
}
