export type ImageChoice = {
  id: string;
  name: string;
  linux: boolean;
  system: boolean;
};

/** Prefer an Ubuntu system image. One id, not the whole catalog. */
export function pickImage(images: ImageChoice[]): ImageChoice {
  const linux = images.filter((image) => image.linux && image.system && image.id);
  const ubuntu = linux.filter((image) => /ubuntu/i.test(image.name));
  const preferred =
    ubuntu.find((image) => /24\.04/.test(image.name)) ??
    ubuntu.find((image) => /22\.04/.test(image.name)) ??
    ubuntu[0] ??
    linux[0];
  if (!preferred) throw new Error("No Linux system image in this region.");
  return preferred;
}
