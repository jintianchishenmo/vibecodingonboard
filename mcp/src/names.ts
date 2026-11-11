/** App names become server names. Lowercase, short, safe for both clouds. */
export function toAppName(raw: string): string {
  const name = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (name.length < 2) throw new Error("App name must be at least 2 letters or digits.");
  return name;
}

export function instanceName(app: string): string {
  return `lz-${app}`.slice(0, 50);
}
