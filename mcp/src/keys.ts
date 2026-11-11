import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { utils } = require("ssh2") as {
  utils: { generateKeyPairSync: (type: string) => { public: string; private: string } };
};

export function newKeyPair(): { publicKey: string; privateKey: string } {
  const pair = utils.generateKeyPairSync("ed25519");
  return { publicKey: pair.public.trim(), privateKey: pair.private };
}
