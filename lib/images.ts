export const IMAGE_BUCKET = "item-images";

/** Public URL for a stored photo path (bucket is public-read). */
export function imageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${base}/storage/v1/object/public/${IMAGE_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** Stable color for an item's fallback tile, from its category (or name). */
export function tileColor(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hues = [140, 200, 330, 25, 270, 95, 175, 10, 45, 300];
  return hues[h % hues.length];
}

export function initials(name: string) {
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "?";
}
