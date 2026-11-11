export function messageOf(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/\s+/g, " ").slice(0, 800);
}

export function isAlready(err: unknown): boolean {
  return /already exist/i.test(messageOf(err));
}
