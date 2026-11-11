/** Remove stored secrets from text that will be shown to the user's AI. */
export function redact(text: string, secrets: Array<string | undefined>): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join("[redacted]");
  }
  return out;
}

export function tail(text: string, lines = 40): string {
  return text.trim().split(/\r?\n/).slice(-lines).join("\n");
}
