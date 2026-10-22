import Link from "next/link";
import { imageUrl } from "@/lib/images";

export type MapArea = { id: string; name: string; x: number; y: number; w: number; h: number; color: string };
export type MapMark = "home" | "here" | "both";

/** Static view of the shop floor plan with some areas marked. */
export function MiniMap({
  aspect,
  background,
  areas,
  marks,
  caption,
  href = "/floor-plan",
}: {
  aspect: number;
  background: string | null;
  areas: MapArea[];
  marks: Record<string, MapMark>;
  caption?: React.ReactNode;
  href?: string;
}) {
  if (!areas.length) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 bg-white px-4 py-6 text-center text-sm text-stone-500">
        No floor plan yet.{" "}
        <Link href={href} className="link">
          Set up Location in shop
        </Link>
      </div>
    );
  }
  const bg = imageUrl(background);
  return (
    <div className="space-y-2">
      <Link
        href={href}
        className="lift relative block overflow-hidden rounded-lg border border-stone-200 bg-stone-100"
        style={{ aspectRatio: String(aspect) }}
        aria-label="Open the shop floor plan"
      >
        {bg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bg} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />
        ) : (
          <div className="plan-grid absolute inset-0" />
        )}
        {areas.map((a) => {
          const m = marks[a.id];
          return (
            <div
              key={a.id}
              className={`absolute flex items-center justify-center overflow-hidden rounded-[3px] border text-center text-[10px] leading-tight font-medium ${
                m ? "z-10" : "opacity-45"
              } ${m === "home" || m === "both" ? "plan-pulse" : ""}`}
              style={{
                left: `${a.x}%`,
                top: `${a.y}%`,
                width: `${a.w}%`,
                height: `${a.h}%`,
                borderColor: a.color,
                borderWidth: m ? 2 : 1,
                background: `color-mix(in srgb, ${a.color} ${m ? 38 : 14}%, transparent)`,
                color: "var(--color-stone-900)",
              }}
            >
              <span className="px-1">{a.name}</span>
            </div>
          );
        })}
      </Link>
      {caption && <div className="text-xs text-stone-500">{caption}</div>}
    </div>
  );
}
