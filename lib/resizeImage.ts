/** Browser-side: shrink a photo before upload (phone photos are often 4–12 MB). */
export async function resizeImage(file: File, maxSide = 1400, quality = 0.84): Promise<{ blob: Blob; width: number; height: number }> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file (JPEG, PNG, HEIC or WebP).");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That image couldn't be read. Try a JPEG or PNG.");
  });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", quality));
  const out = blob ?? (await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality)));
  if (!out) throw new Error("That image couldn't be processed.");
  return { blob: out, width, height };
}
