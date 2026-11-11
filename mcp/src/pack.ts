import { create } from "tar";

// Rebuilt on the server, or never needed there.
const SKIP = new Set(["node_modules", ".git", ".next", ".nuxt", ".svelte-kit", ".turbo", ".vercel", ".DS_Store"]);

/** Packs a project folder into a gzipped tar in memory. */
export async function packProject(dir: string): Promise<Buffer> {
  const stream = create(
    {
      gzip: true,
      cwd: dir,
      portable: true,
      filter: (path) => !path.split(/[\\/]/).some((segment) => SKIP.has(segment)),
    },
    ["."],
  );
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}
