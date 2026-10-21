"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { ItemThumb } from "./ItemThumb";
import { resizeImage } from "@/lib/resizeImage";
import { AREA_COLORS } from "@/lib/plan";

type Rect = { x: number; y: number; w: number; h: number };
export type PlanArea = Rect & { id: string; name: string; color: string };
export type PlanLocation = { id: string; name: string; kind: string; active: boolean };
export type PlanItem = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  image: string | null;
  baseUnit: string;
  home: string | null;
  stock: Record<string, number>; // location id → base qty
};
type Result = { error?: string } | void;

const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n);
const SHAPES: [string, number][] = [
  ["Wide", 1.6],
  ["Square", 1],
  ["Tall", 0.7],
];

export function FloorPlan(props: {
  aspect: number;
  backgroundUrl: string | null;
  areas: PlanArea[];
  locations: PlanLocation[];
  items: PlanItem[];
  canEdit: boolean;
  canAssign: boolean;
  initialItem?: string | null;
  actions: {
    saveArea: (id: string, r: Rect & { color?: string }) => Promise<Result>;
    removeArea: (id: string) => Promise<Result>;
    setPlanShape: (aspect: number) => Promise<Result>;
    uploadBackground: (fd: FormData) => Promise<Result>;
    removeBackground: () => Promise<Result>;
    setHome: (productId: string, locationId: string | null) => Promise<Result>;
  };
}) {
  const { actions, canEdit, canAssign } = props;
  const [areas, setAreas] = useState<PlanArea[]>(props.areas);
  const [items, setItems] = useState<PlanItem[]>(props.items);
  const [aspect, setAspect] = useState(props.aspect);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [found, setFound] = useState<string | null>(props.initialItem ?? null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const planRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; mode: "move" | "resize"; sx: number; sy: number; r: Rect; moved: boolean } | null>(null);

  const locName = (id: string | null) => props.locations.find((l) => l.id === id)?.name ?? "—";
  const placedIds = new Set(areas.map((a) => a.id));
  const unplaced = props.locations.filter((l) => l.active && !placedIds.has(l.id));
  const item = items.find((i) => i.id === found) ?? null;
  const area = areas.find((a) => a.id === selected) ?? null;

  const stockIn = useMemo(() => {
    const m: Record<string, { item: PlanItem; qty: number }[]> = {};
    for (const it of items) for (const [loc, q] of Object.entries(it.stock)) if (q > 0) (m[loc] ||= []).push({ item: it, qty: q });
    for (const k in m) m[k].sort((a, b) => b.qty - a.qty);
    return m;
  }, [items]);

  const misplaced = items.filter((i) => i.home && Object.entries(i.stock).some(([l, q]) => q > 0 && l !== i.home));
  const noHome = items.filter((i) => !i.home);
  const matches = query.trim()
    ? items.filter((i) => `${i.sku} ${i.name} ${i.category ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)
    : [];

  function run(fn: () => Promise<Result>, rollback?: () => void) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r && r.error) {
        setError(r.error);
        rollback?.();
      }
    });
  }

  // ---------- dragging ----------
  function onPointerDown(e: React.PointerEvent, a: PlanArea, mode: "move" | "resize") {
    if (!editing) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { id: a.id, mode, sx: e.clientX, sy: e.clientY, r: { x: a.x, y: a.y, w: a.w, h: a.h }, moved: false };
    setSelected(a.id);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    const box = planRef.current?.getBoundingClientRect();
    if (!d || !box) return;
    const dx = ((e.clientX - d.sx) / box.width) * 100;
    const dy = ((e.clientY - d.sy) / box.height) * 100;
    if (Math.abs(dx) + Math.abs(dy) > 0.3) d.moved = true;
    const snap = (n: number) => Math.round(n * 2) / 2;
    setAreas((all) =>
      all.map((a) => {
        if (a.id !== d.id) return a;
        if (d.mode === "move") {
          return { ...a, x: snap(Math.min(100 - a.w, Math.max(0, d.r.x + dx))), y: snap(Math.min(100 - a.h, Math.max(0, d.r.y + dy))) };
        }
        return { ...a, w: snap(Math.min(100 - a.x, Math.max(4, d.r.w + dx))), h: snap(Math.min(100 - a.y, Math.max(4, d.r.h + dy))) };
      }),
    );
  }
  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.moved) return;
    const a = areas.find((x) => x.id === d.id);
    if (!a) return;
    const before = d.r;
    run(
      () => actions.saveArea(a.id, { x: a.x, y: a.y, w: a.w, h: a.h }),
      () => setAreas((all) => all.map((x) => (x.id === d.id ? { ...x, ...before } : x))),
    );
  }
  function nudge(e: React.KeyboardEvent, a: PlanArea) {
    if (!editing) return;
    const step = e.shiftKey ? 5 : 1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    const next = { ...a, x: Math.min(100 - a.w, Math.max(0, a.x + m[0])), y: Math.min(100 - a.h, Math.max(0, a.y + m[1])) };
    setAreas((all) => all.map((x) => (x.id === a.id ? next : x)));
    run(() => actions.saveArea(a.id, next));
  }

  function place(loc: PlanLocation) {
    const color = AREA_COLORS[areas.length % AREA_COLORS.length];
    const a: PlanArea = { id: loc.id, name: loc.name, x: 40, y: 40, w: 20, h: 16, color };
    setAreas((all) => [...all, a]);
    setSelected(loc.id);
    run(
      () => actions.saveArea(loc.id, { ...a }),
      () => setAreas((all) => all.filter((x) => x.id !== loc.id)),
    );
  }
  function recolor(a: PlanArea, color: string) {
    setAreas((all) => all.map((x) => (x.id === a.id ? { ...x, color } : x)));
    run(() => actions.saveArea(a.id, { x: a.x, y: a.y, w: a.w, h: a.h, color }));
  }
  function unplace(a: PlanArea) {
    setAreas((all) => all.filter((x) => x.id !== a.id));
    setSelected(null);
    run(() => actions.removeArea(a.id), () => setAreas((all) => [...all, a]));
  }
  function setHome(it: PlanItem, locId: string | null) {
    const prev = it.home;
    setItems((all) => all.map((x) => (x.id === it.id ? { ...x, home: locId } : x)));
    run(() => actions.setHome(it.id, locId), () => setItems((all) => all.map((x) => (x.id === it.id ? { ...x, home: prev } : x))));
  }
  async function onBackground(file?: File) {
    if (!file) return;
    setError(null);
    try {
      const { blob, width, height } = await resizeImage(file, 2400, 0.86);
      const fd = new FormData();
      fd.append("file", new File([blob], "plan.webp", { type: blob.type }));
      fd.append("aspect", String(width / height));
      run(async () => {
        const r = await actions.uploadBackground(fd);
        if (!r || !r.error) setAspect(Math.round((width / height) * 1000) / 1000);
        return r;
      });
    } catch (e: any) {
      setError(e?.message ?? "Upload failed");
    }
  }

  // ---------- render ----------
  const markFor = (a: PlanArea) => {
    if (!item) return null;
    const q = item.stock[a.id] ?? 0;
    const isHome = item.home === a.id;
    if (isHome && q > 0) return { kind: "home-stock" as const, q };
    if (isHome) return { kind: "home" as const, q };
    if (q > 0) return { kind: "away" as const, q };
    return null;
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <input
              className="input"
              placeholder="Find an item: name, SKU or category"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Find an item on the floor plan"
            />
            {matches.length > 0 && (
              <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-stone-200 bg-white shadow-lg">
                {matches.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-stone-50"
                      onClick={() => {
                        setFound(m.id);
                        setSelected(null);
                        setQuery("");
                      }}
                    >
                      <ItemThumb path={m.image} name={m.name} category={m.category} size={28} />
                      <span className="min-w-0 flex-1 truncate">{m.name}</span>
                      <span className="font-mono text-xs text-stone-500">{m.sku}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {item && (
            <button type="button" className="btn btn-sm" onClick={() => setFound(null)}>
              Clear “{item.name}”
            </button>
          )}
          {canEdit && (
            <button type="button" className={`btn ${editing ? "btn-primary" : ""}`} onClick={() => setEditing((v) => !v)} aria-pressed={editing}>
              {editing ? "Done editing" : "Edit layout"}
            </button>
          )}
          {pending && <span className="text-xs text-stone-500">Saving…</span>}
        </div>

        {error && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        {editing && (
          <div className="card flex flex-wrap items-center gap-3 text-sm">
            <span className="text-stone-500">Drag areas to move them; drag the corner to resize; arrow keys nudge.</span>
            <div className="flex items-center gap-1">
              <span className="label mb-0">Shape</span>
              {SHAPES.map(([label, v]) => (
                <button
                  key={label}
                  type="button"
                  className={`btn btn-sm ${Math.abs(aspect - v) < 0.01 ? "btn-primary" : ""}`}
                  onClick={() => {
                    const prev = aspect;
                    setAspect(v);
                    run(() => actions.setPlanShape(v), () => setAspect(prev));
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="btn btn-sm cursor-pointer">
              {props.backgroundUrl ? "Replace floor image" : "Upload floor image"}
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => onBackground(e.target.files?.[0])} />
            </label>
            {props.backgroundUrl && (
              <button type="button" className="btn btn-sm btn-danger" onClick={() => run(() => actions.removeBackground())}>
                Remove image
              </button>
            )}
            {unplaced.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="label mb-0">Place</span>
                {unplaced.map((l) => (
                  <button key={l.id} type="button" className="btn btn-sm" onClick={() => place(l)}>
                    + {l.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div
          ref={planRef}
          className={`relative w-full touch-none overflow-hidden rounded-lg border border-stone-200 select-none ${editing ? "ring-2 ring-brand-600/40" : ""}`}
          style={{ aspectRatio: String(aspect) }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          {props.backgroundUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={props.backgroundUrl} alt="Shop floor" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="plan-grid pointer-events-none absolute inset-0" />
          )}
          {areas.map((a) => {
            const mark = markFor(a);
            const count = stockIn[a.id]?.length ?? 0;
            const dim = item && !mark;
            const isSel = selected === a.id;
            return (
              <div
                key={a.id}
                role="button"
                tabIndex={0}
                aria-label={`${a.name}${count ? `, ${count} items stored` : ""}`}
                aria-pressed={isSel}
                className={`absolute flex flex-col overflow-hidden rounded-md border-2 p-1.5 text-left transition-[opacity,box-shadow] duration-200 ${
                  editing ? "cursor-move" : "cursor-pointer"
                } ${dim ? "opacity-35" : ""} ${mark?.kind === "home" || mark?.kind === "home-stock" ? "plan-pulse" : ""} ${
                  isSel ? "ring-2 ring-offset-1 ring-stone-900/60" : ""
                }`}
                style={{
                  left: `${a.x}%`,
                  top: `${a.y}%`,
                  width: `${a.w}%`,
                  height: `${a.h}%`,
                  borderColor: mark?.kind === "away" ? "var(--color-amber-700)" : a.color,
                  background: `color-mix(in srgb, ${a.color} ${mark ? 34 : 18}%, color-mix(in srgb, var(--color-white) 70%, transparent))`,
                }}
                onPointerDown={(e) => onPointerDown(e, a, "move")}
                onClick={() => {
                  if (!editing) setSelected(isSel ? null : a.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected(isSel ? null : a.id);
                  } else nudge(e, a);
                }}
              >
                <span className="truncate text-xs leading-tight font-semibold text-stone-900">{a.name}</span>
                <span className="truncate text-[11px] text-stone-700">{count ? `${count} item${count === 1 ? "" : "s"}` : "Empty"}</span>
                {mark && (
                  <span
                    className={`mt-auto self-start rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      mark.kind === "away" ? "bg-amber-50 text-amber-800" : "bg-brand-50 text-brand-800"
                    }`}
                  >
                    {mark.kind === "home" ? "Home · none here" : mark.kind === "home-stock" ? `Home · ${fmt(mark.q)}` : `${fmt(mark.q)} here`}
                  </span>
                )}
                {editing && (
                  <span
                    className="absolute right-0 bottom-0 h-4 w-4 cursor-nwse-resize rounded-tl bg-stone-900/50"
                    onPointerDown={(e) => onPointerDown(e, a, "resize")}
                    aria-hidden="true"
                  />
                )}
              </div>
            );
          })}
          {areas.length === 0 && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-stone-600">
              {canEdit ? "Click Edit layout, then place your locations on the plan." : "No areas placed yet. Ask Warehouse or Admin to set up the plan."}
            </div>
          )}
        </div>
        <p className="text-xs text-stone-500">
          Areas are your stock locations. Pulsing = an item&apos;s home area. Amber = stock sitting outside its home area.
        </p>
      </div>

      <aside className="space-y-4">
        {item ? (
          <div className="card space-y-3">
            <div className="flex items-start gap-3">
              <ItemThumb path={item.image} name={item.name} category={item.category} size={56} />
              <div className="min-w-0">
                <Link href={`/products/${item.id}`} className="link font-semibold">
                  {item.name}
                </Link>
                <div className="font-mono text-xs text-stone-500">{item.sku}</div>
                <div className="text-xs text-stone-500">{item.category ?? "Uncategorized"}</div>
              </div>
            </div>
            <div className="text-sm">
              <div className="label">Home area</div>
              {canAssign ? (
                <select className="input" value={item.home ?? ""} onChange={(e) => setHome(item, e.target.value || null)}>
                  <option value="">Not set</option>
                  {props.locations
                    .filter((l) => l.active)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                </select>
              ) : (
                <div>{locName(item.home)}</div>
              )}
            </div>
            <div className="text-sm">
              <div className="label">Stock now</div>
              {Object.entries(item.stock).filter(([, q]) => q > 0).length === 0 ? (
                <div className="text-stone-500">None on hand</div>
              ) : (
                <ul className="space-y-1">
                  {Object.entries(item.stock)
                    .filter(([, q]) => q > 0)
                    .map(([l, q]) => (
                      <li key={l} className="flex justify-between gap-2">
                        <span className={item.home && l !== item.home ? "font-medium text-amber-700" : ""}>{locName(l)}</span>
                        <span className="tabular-nums">
                          {fmt(q)} {item.baseUnit}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </div>
        ) : area ? (
          <div className="card space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">{area.name}</h3>
              <span className="h-3 w-3 rounded-full" style={{ background: area.color }} aria-hidden="true" />
            </div>
            {editing && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Area color">
                  {AREA_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={c === area.color}
                      aria-label={`Color ${c}`}
                      className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${c === area.color ? "border-stone-900" : "border-transparent"}`}
                      style={{ background: c }}
                      onClick={() => recolor(area, c)}
                    />
                  ))}
                </div>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => unplace(area)}>
                  Remove from plan
                </button>
              </div>
            )}
            <div>
              <div className="label">Stored here now</div>
              {(stockIn[area.id] ?? []).length === 0 ? (
                <p className="text-sm text-stone-500">Nothing on hand here.</p>
              ) : (
                <ul className="space-y-1.5">
                  {(stockIn[area.id] ?? []).map(({ item: it, qty }) => (
                    <li key={it.id} className="flex items-center gap-2 text-sm">
                      <ItemThumb path={it.image} name={it.name} category={it.category} size={28} />
                      <button type="button" className="link min-w-0 flex-1 truncate text-left" onClick={() => setFound(it.id)}>
                        {it.name}
                      </button>
                      <span className={`tabular-nums ${it.home && it.home !== area.id ? "font-medium text-amber-700" : ""}`}>
                        {fmt(qty)} {it.baseUnit}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="label">Belongs here</div>
              {items.filter((i) => i.home === area.id).length === 0 ? (
                <p className="text-sm text-stone-500">No items have this as their home area.</p>
              ) : (
                <ul className="space-y-1">
                  {items
                    .filter((i) => i.home === area.id)
                    .map((it) => {
                      const here = it.stock[area.id] ?? 0;
                      const elsewhere = Object.entries(it.stock).filter(([l, q]) => q > 0 && l !== area.id);
                      return (
                        <li key={it.id} className="flex items-center justify-between gap-2 text-sm">
                          <button type="button" className="link truncate text-left" onClick={() => setFound(it.id)}>
                            {it.name}
                          </button>
                          <span className={`text-xs ${elsewhere.length ? "font-medium text-amber-700" : here ? "text-brand-700" : "text-stone-500"}`}>
                            {elsewhere.length ? `Also in ${elsewhere.map(([l]) => locName(l)).join(", ")}` : here ? "In place" : "None on hand"}
                          </span>
                        </li>
                      );
                    })}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <div className="card space-y-3 text-sm">
            <p className="text-stone-600">Click an area to see what&apos;s there, or find an item to light up where it belongs.</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md bg-stone-100 p-2">
                <div className="text-lg font-semibold tabular-nums">{misplaced.length}</div>
                <div className="text-xs text-stone-500">items with stock outside home</div>
              </div>
              <div className="rounded-md bg-stone-100 p-2">
                <div className="text-lg font-semibold tabular-nums">{noHome.length}</div>
                <div className="text-xs text-stone-500">items with no home area</div>
              </div>
            </div>
            {misplaced.length > 0 && (
              <div>
                <div className="label">Out of place</div>
                <ul className="space-y-1">
                  {misplaced.slice(0, 8).map((it) => (
                    <li key={it.id}>
                      <button type="button" className="link text-left" onClick={() => setFound(it.id)}>
                        {it.name}
                      </button>{" "}
                      <span className="text-xs text-stone-500">belongs in {locName(it.home)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {noHome.length > 0 && canAssign && (
              <div>
                <div className="label">Needs a home area</div>
                <ul className="space-y-1.5">
                  {noHome.slice(0, 8).map((it) => (
                    <li key={it.id} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">{it.name}</span>
                      <select className="input w-36 py-1 text-xs" value="" onChange={(e) => setHome(it, e.target.value || null)} aria-label={`Home area for ${it.name}`}>
                        <option value="">Set…</option>
                        {props.locations
                          .filter((l) => l.active)
                          .map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                      </select>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
