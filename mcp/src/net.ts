import { connect } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

export async function poll<T>(load: () => Promise<T | null>, budgetMs: number, intervalMs = 5000): Promise<T> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const value = await load();
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error("Timed out waiting for the server.");
}

export async function callerIpv4(fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl("https://checkip.amazonaws.com");
  if (!res.ok) throw new Error("Could not detect this computer's public IP. Pass ssh_cidr.");
  const ip = (await res.text()).trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error("Could not detect this computer's public IP. Pass ssh_cidr.");
  return ip;
}

export function tcpOpen(host: string, port: number, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

export async function waitForTcp(host: string, port: number, budgetMs: number): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (await tcpOpen(host, port)) return;
    await sleep(3000);
  }
  throw new Error(`Port ${port} on ${host} did not open in time.`);
}
