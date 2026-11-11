import { spawn } from "node:child_process";
import type { WriteStream } from "node:fs";

const MAX_CAPTURE = 64 * 1024;

/** Runs the docker CLI. Output is captured (last 64 KB) and optionally streamed to a log file. */
export function docker(args: string[], log?: WriteStream): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { windowsHide: true });
    let output = "";
    const collect = (chunk: Buffer) => {
      log?.write(chunk);
      output = (output + chunk.toString()).slice(-MAX_CAPTURE);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}
