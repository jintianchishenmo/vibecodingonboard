import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Local config directory. Tests set LANDINGZONE_HOME. */
export function landingRoot(): string {
  const dir = process.env.LANDINGZONE_HOME ?? join(homedir(), ".landingzone");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function landingFile(name: string): string {
  return join(landingRoot(), name);
}

/** Keep key files readable only by the current user. */
export function lockDown(file: string): void {
  if (process.platform === "win32") {
    const user = process.env.USERNAME;
    if (!user) return;
    spawnSync("icacls", [file, "/inheritance:r", "/grant:r", `${user}:(R,W)`], { windowsHide: true });
    return;
  }
  chmodSync(file, 0o600);
}
