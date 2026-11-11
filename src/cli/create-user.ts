// Creates a user and prints their API token (shown once). Stand-in for website sign-up.
// Usage: npm run create-user -- <email> [app_limit]
import { hashToken, newToken } from "../auth.ts";
import { users } from "../db.ts";

const [email, limitArg] = process.argv.slice(2);
if (!email) {
  console.error("Usage: npm run create-user -- <email> [app_limit]");
  process.exit(1);
}

const token = newToken();
users.create(email, hashToken(token), Number(limitArg ?? 1));
console.log(`Created ${email}. API token (save it now, it is not stored):\n${token}`);
