import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { users, type User } from "./db.ts";

// Only the hash is stored, so a leaked database does not leak usable tokens.
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return "lz_" + randomBytes(24).toString("base64url");
}

export function userFromRequest(req: IncomingMessage): User | undefined {
  const match = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "");
  return match ? users.byTokenHash(hashToken(match[1])) : undefined;
}
