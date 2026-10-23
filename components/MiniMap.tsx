import Link from "next/link";
import { imageUrl } from "@/lib/images";
import { centroid, toSvg, type Pt } from "@/lib/shapes";

export type MapArea = { id: string; name: string; x: number; y: number; w: number; h: number; color: string; points: Pt[] };
export type MapMark = "home" | "here" | "both";

/** Static view of a shop's floor plan with some areas marked. */
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
      <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-4 py-6 text-center text-sm text-stone-500">
        No floor plan yet.{" "}
        <Link href={href} className="link">
          Set up Location in shop
        </Link>
      </div>
    );
  }
  const bg = imageUrl(background);
  const vbW = 100 * aspect;
  return (
    <div className="space-y-2">
      <Link
        href={href}
        className="lift relative block overflow-hidden rounded-2xl border border-stone-200 bg-stone-100"
        style={{ aspectRatio: String(aspect) }}
        aria-label="Open the shop floor plan"
      >
        {bg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bg} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />
        ) : (
          <div className="plan-grid absolute inset-0" />
        )}
        <svg viewBox={`0 0 ${vbW} 100`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
          {areas.map((a) => {
            const m = marks[a.id];
            return (
              <polygon
                key={a.id}
                points={toSvg(a.points, aspect)}
                fill={a.color}
                fillOpacity={m ? 0.4 : 0.14}
                stroke={a.color}
                strokeWidth={m ? 2 : 1}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                className={m === "home" || m === "both" ? "shape-pulse" : m ? "" : "opacity-60"}
              />
            );
          })}
        </svg>
        {areas.map((a) => {
          const [cx, cy] = centroid(a.points, aspect);
          return (
            <span
              key={a.id}
              className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 px-1 text-center text-[10px] leading-tight font-medium whitespace-nowrap text-stone-900 ${marks[a.id] ? "" : "opacity-60"}`}
              style={{ left: `${cx}%`, top: `${cy}%` }}
            >
              {a.name}
            </span>
          );
        })}
      </Link>
      {caption && <div className="text-xs text-stone-500">{caption}</div>}
    </div>
  );
}
