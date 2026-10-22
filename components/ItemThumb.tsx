import { imageUrl, initials, tileColor } from "@/lib/images";

/** Item photo, or a colored tile with the item's initials (colored by category). */
export function ItemThumb({
  path,
  name,
  category,
  size = 36,
  className = "",
}: {
  path?: string | null;
  name: string;
  category?: string | null;
  size?: number;
  className?: string;
}) {
  const url = imageUrl(path);
  const style = { width: size, height: size };
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name}
        loading="lazy"
        style={style}
        className={`shrink-0 rounded-lg border border-stone-200 bg-stone-100 object-cover ${className}`}
      />
    );
  }
  const hue = tileColor(category || name);
  return (
    <span
      aria-hidden="true"
      style={{ ...style, fontSize: Math.max(10, size * 0.34), ["--h" as string]: hue }}
      className="tile-thumb inline-grid shrink-0 place-items-center rounded-lg font-semibold tracking-wide"
    >
      {initials(name)}
    </span>
  );
}

/** Thumbnail + name + SKU, for table cells. */
export function ItemCell({
  path,
  name,
  sku,
  category,
  children,
}: {
  path?: string | null;
  name: React.ReactNode;
  sku?: string;
  category?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <ItemThumb path={path} name={typeof name === "string" ? name : sku ?? "?"} category={category} size={34} />
      <div className="min-w-0">
        {children ?? name}
        {sku && <div className="text-xs text-stone-500 tabular-nums">{sku}</div>}
      </div>
    </div>
  );
}

/** Full-width photo for cards; a soft category-coloured tile with initials when there's no photo. */
export function ItemPhoto({ path, name, category }: { path?: string | null; name: string; category?: string | null }) {
  const url = imageUrl(path);
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} loading="lazy" className="aspect-[4/3] w-full bg-stone-100 object-cover" />;
  }
  const hue = tileColor(category || name);
  return (
    <div
      aria-hidden="true"
      className="tile-photo font-display grid aspect-[4/3] w-full place-items-center text-4xl"
      style={{ ["--h" as string]: hue }}
    >
      {initials(name)}
    </div>
  );
}
