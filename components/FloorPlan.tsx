"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { ItemThumb } from "./ItemThumb";
import { resizeImage } from "@/lib/resizeImage";
import { AREA_COLORS, type DoorSide, type PlanDoor } from "@/lib/plan";

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
type Created = { error?: string; id?: string };
type Drag =
  | { kind: "area"; id: string; mode: "move" | "resize"; sx: number; sy: number; r: Rect; moved: boolean }
  | { kind: "door"; id: string; before: PlanDoor; moved: boolean };

/** Grab zone (px) at an area's bottom-right corner that resizes instead of moving. */
const CORNER = 22;

const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n);
const SHAPES: [string, number][] = [
  ["Wide", 1.6],
  ["Square", 1],
  ["Tall", 0.7],
];

export function FloorPlan(props: {
  layout: { id: string; name: string };
  layouts: { id: string; name: string }[];
  doors: PlanDoor[];
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
    setPlanShape: (layoutId: string, aspect: number) => Promise<Result>;
    uploadBackground: (fd: FormData) => Promise<Result>;
    removeBackground: (layoutId: string) => Promise<Result>;
    setHome: (productId: string, layoutId: string, locationId: string | null) => Promise<Result>;
    createLayout: (name: string) => Promise<Created>;
    renameLayout: (id: string, name: string) => Promise<Result>;
    deleteLayout: (id: string, moveTo: string) => Promise<Result>;
    addDoor: (layoutId: string, d: { kind: string; label: string; side: string; pos: number }) => Promise<Created>;
    saveDoor: (id: string, d: { kind?: string; label?: string; side?: string; pos?: number }) => Promise<Result>;
    removeDoor: (id: string) => Promise<Result>;
  };
}) {
  const { actions, canEdit, canAssign } = props;
  const layoutId = props.layout.id;
  const router = useRouter();
  const [areas, setAreas] = useState<PlanArea[]>(props.areas);
  const [doors, setDoors] = useState<PlanDoor[]>(props.doors);
  const [selectedDoor, setSelectedDoor] = useState<string | null>(null);
  const [layoutForm, setLayoutForm] = useState<null | "new" | "rename" | "delete">(null);
  const [items, setItems] = useState<PlanItem[]>(props.items);
  const [aspect, setAspect] = useState(props.aspect);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [found, setFound] = useState<string | null>(props.initialItem ?? null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const planRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const areasRef = useRef(areas);
  areasRef.current = areas;
  const bgDown = useRef(false);
  const doorsRef = useRef(doors);
  doorsRef.current = doors;

  const locName = (id: string | null) => props.locations.find((l) => l.id === id)?.name ?? "—";
  const placedIds = new Set(areas.map((a) => a.id));
  const unplaced = props.locations.filter((l) => l.active && !placedIds.has(l.id));
  const item = items.find((i) => i.id === found) ?? null;
  const area = areas.find((a) => a.id === selected) ?? null;
  const door = doors.find((d) => d.id === selectedDoor) ?? null;

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
    if (!editing || e.button > 0) return;
    e.preventDefault();
    e.stopPropagation();
    // Pressing near the bottom-right corner resizes, even outside the visible grip
    const el = e.currentTarget.closest("[data-area]") as HTMLElement | null;
    if (mode === "move" && el) {
      const r = el.getBoundingClientRect();
      if (r.right - e.clientX <= CORNER && r.bottom - e.clientY <= CORNER) mode = "resize";
    }
    planRef.current?.setPointerCapture(e.pointerId);
    drag.current = { kind: "area", id: a.id, mode, sx: e.clientX, sy: e.clientY, r: { x: a.x, y: a.y, w: a.w, h: a.h }, moved: false };
    setSelected(a.id);
    setSelectedDoor(null);
  }
  function onDoorDown(e: React.PointerEvent, d: PlanDoor) {
    e.stopPropagation();
    setSelectedDoor(d.id);
    setSelected(null);
    if (!editing || e.button > 0) return;
    e.preventDefault();
    planRef.current?.setPointerCapture(e.pointerId);
    drag.current = { kind: "door", id: d.id, before: d, moved: false };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    const box = planRef.current?.getBoundingClientRect();
    if (!d || !box) return;
    if (d.kind === "door") {
      // Snap to the nearest wall, slide along it
      const px = Math.min(box.width, Math.max(0, e.clientX - box.left));
      const py = Math.min(box.height, Math.max(0, e.clientY - box.top));
      const dist: [DoorSide, number][] = [
        ["top", py],
        ["bottom", box.height - py],
        ["left", px],
        ["right", box.width - px],
      ];
      const side = dist.sort((x, y) => x[1] - y[1])[0][0];
      const along = side === "top" || side === "bottom" ? (px / box.width) * 100 : (py / box.height) * 100;
      const pos = Math.round(Math.min(97, Math.max(3, along)) * 2) / 2;
      d.moved = true;
      setDoors((all) => all.map((x) => (x.id === d.id ? { ...x, side, pos } : x)));
      return;
    }
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
        return { ...a, w: snap(Math.min(100 - d.r.x, Math.max(4, d.r.w + dx))), h: snap(Math.min(100 - d.r.y, Math.max(4, d.r.h + dy))) };
      }),
    );
  }
  function onPointerUp(e: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    if (planRef.current?.hasPointerCapture(e.pointerId)) planRef.current.releasePointerCapture(e.pointerId);
    if (!d || !d.moved) return;
    if (d.kind === "door") {
      const cur = doorsRef.current.find((x) => x.id === d.id);
      if (!cur) return;
      run(
        () => actions.saveDoor(d.id, { side: cur.side, pos: cur.pos }),
        () => setDoors((all) => all.map((x) => (x.id === d.id ? d.before : x))),
      );
      return;
    }
    const a = areasRef.current.find((x) => x.id === d.id);
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
    run(() => actions.setHome(it.id, layoutId, locId), () => setItems((all) => all.map((x) => (x.id === it.id ? { ...x, home: prev } : x))));
  }
  async function onBackground(file?: File) {
    if (!file) return;
    setError(null);
    try {
      const { blob, width, height } = await resizeImage(file, 2400, 0.86);
      const fd = new FormData();
      fd.append("file", new File([blob], "plan.webp", { type: blob.type }));
      fd.append("aspect", String(width / height));
      fd.append("layout_id", layoutId);
      run(async () => {
        const r = await actions.uploadBackground(fd);
        if (!r || !r.error) setAspect(Math.round((width / height) * 1000) / 1000);
        return r;
      });
    } catch (e: any) {
      setError(e?.message ?? "Upload failed");
    }
  }

  function newDoor(fd: FormData) {
    const kind = String(fd.get("kind") ?? "entry");
    const label = String(fd.get("label") ?? "");
    // First free spot on the wall so new markers don't stack on each other
    const side = kind === "exit" ? "top" : "bottom";
    const taken = doors.filter((d) => d.side === side).map((d) => d.pos);
    const pos = [50, 25, 75, 12.5, 37.5, 62.5, 87.5].find((p) => taken.every((t) => Math.abs(t - p) > 8)) ?? 50;
    const spot = { side, pos };
    setError(null);
    start(async () => {
      const r = await actions.addDoor(layoutId, { kind, label, ...spot });
      if (r.error || !r.id) return setError(r.error ?? "Couldn't add it.");
      setDoors((all) => [...all, { id: r.id!, kind: kind as PlanDoor["kind"], label: label.trim().replace(/\s+/g, " "), side: spot.side as DoorSide, pos: spot.pos }]);
      setSelectedDoor(r.id);
      setSelected(null);
    });
  }
  function editDoor(d: PlanDoor, patch: Partial<PlanDoor>) {
    setDoors((all) => all.map((x) => (x.id === d.id ? { ...x, ...patch } : x)));
    run(() => actions.saveDoor(d.id, patch), () => setDoors((all) => all.map((x) => (x.id === d.id ? d : x))));
  }
  function dropDoor(d: PlanDoor) {
    setDoors((all) => all.filter((x) => x.id !== d.id));
    setSelectedDoor(null);
    run(() => actions.removeDoor(d.id), () => setDoors((all) => [...all, d]));
  }
  function layoutSubmit(fd: FormData) {
    setError(null);
    start(async () => {
      if (layoutForm === "new") {
        const r = await actions.createLayout(String(fd.get("name") ?? ""));
        if (r.error || !r.id) return setError(r.error ?? "Couldn't create it.");
        setLayoutForm(null);
        router.push(`/floor-plan?layout=${r.id}`);
      } else if (layoutForm === "rename") {
        const r = await actions.renameLayout(layoutId, String(fd.get("name") ?? ""));
        if (r && r.error) return setError(r.error);
        setLayoutForm(null);
        router.refresh();
      } else if (layoutForm === "delete") {
        const to = String(fd.get("move_to") ?? "");
        const r = await actions.deleteLayout(layoutId, to);
        if (r && r.error) return setError(r.error);
        setLayoutForm(null);
        router.push(`/floor-plan?layout=${to}`);
      }
    });
  }
  const others = props.layouts.filter((l) => l.id !== layoutId);

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
        <div className="flex flex-wrap items-center gap-2" data-testid="layout-bar">
          <label className="flex items-center gap-2">
            <span className="label mb-0">Layout</span>
            <select
              className="input w-auto py-1.5"
              value={layoutId}
              onChange={(e) => router.push(`/floor-plan?layout=${e.target.value}`)}
              aria-label="Choose a layout"
            >
              {props.layouts.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          {canEdit && (
            <>
              <button type="button" className="btn btn-sm" onClick={() => setLayoutForm(layoutForm === "new" ? null : "new")} aria-expanded={layoutForm === "new"}>
                + New layout
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setLayoutForm(layoutForm === "rename" ? null : "rename")} aria-expanded={layoutForm === "rename"}>
                Rename
              </button>
              {others.length > 0 && (
                <button type="button" className="btn btn-sm btn-danger" onClick={() => setLayoutForm(layoutForm === "delete" ? null : "delete")} aria-expanded={layoutForm === "delete"}>
                  Delete layout
                </button>
              )}
            </>
          )}
        </div>
        {canEdit && layoutForm && (
          <form
            key={layoutForm}
            className="card flex flex-wrap items-end gap-2 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              layoutSubmit(new FormData(e.currentTarget));
            }}
          >
            {layoutForm === "delete" ? (
              <>
                <p className="w-full text-stone-600">
                  Delete <b>{props.layout.name}</b>? Its entries and exits are removed and its sections move, unplaced, to the layout you pick. Items lose their home area in this shop.
                </p>
                <label className="min-w-48">
                  <span className="label">Move its sections to</span>
                  <select name="move_to" className="input" defaultValue={others[0]?.id}>
                    {others.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="btn btn-danger" disabled={pending}>
                  Delete layout
                </button>
              </>
            ) : (
              <>
                <label className="min-w-56 flex-1">
                  <span className="label">{layoutForm === "new" ? "New layout name" : "Layout name"}</span>
                  <input
                    name="name"
                    className="input"
                    required
                    maxLength={60}
                    autoFocus
                    placeholder="e.g. North shop"
                    defaultValue={layoutForm === "rename" ? props.layout.name : ""}
                  />
                </label>
                <button type="submit" className="btn btn-primary" disabled={pending}>
                  {layoutForm === "new" ? "Create layout" : "Save name"}
                </button>
              </>
            )}
            <button type="button" className="btn" onClick={() => setLayoutForm(null)}>
              Cancel
            </button>
          </form>
        )}
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
                        setSelectedDoor(null);
                        setQuery("");
                      }}
                    >
                      <ItemThumb path={m.image} name={m.name} category={m.category} size={28} />
                      <span className="min-w-0 flex-1 truncate">{m.name}</span>
                      <span className="text-xs text-stone-500 tabular-nums">{m.sku}</span>
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
            <span className="text-stone-500">Drag areas to move them; drag the bottom-right corner to resize; arrow keys nudge. Drag entries and exits along the walls.</span>
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
                    run(() => actions.setPlanShape(layoutId, v), () => setAspect(prev));
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
              <button type="button" className="btn btn-sm btn-danger" onClick={() => run(() => actions.removeBackground(layoutId))}>
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
            <form
              className="flex flex-wrap items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                newDoor(new FormData(e.currentTarget));
                e.currentTarget.reset();
              }}
            >
              <span className="label mb-0">Add</span>
              <select name="kind" className="input w-auto py-1 text-xs" aria-label="Entry or exit">
                <option value="entry">Entry</option>
                <option value="exit">Exit</option>
              </select>
              <input name="label" className="input w-40 py-1 text-xs" placeholder="Label, e.g. Front door" required maxLength={60} aria-label="Entry or exit label" />
              <button type="submit" className="btn btn-sm">
                + Add
              </button>
            </form>
          </div>
        )}

        <div
          ref={planRef}
          className={`relative w-full touch-none overflow-hidden rounded-lg border border-stone-200 select-none ${editing ? "ring-2 ring-brand-600/40" : ""}`}
          style={{ aspectRatio: String(aspect) }}
          onPointerDownCapture={(e) => {
            bgDown.current = e.target === e.currentTarget;
          }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={(e) => {
            // Only a press that started on empty floor clears the selection (drags capture the pointer here)
            if (e.target === e.currentTarget && bgDown.current) {
              setSelected(null);
              setSelectedDoor(null);
            }
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
                data-area={a.id}
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
                  setSelectedDoor(null);
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
                    data-resize={a.id}
                    className="absolute right-0 bottom-0 grid cursor-nwse-resize touch-none place-items-end"
                    style={{ width: CORNER, height: CORNER }}
                    onPointerDown={(e) => onPointerDown(e, a, "resize")}
                    title="Drag to resize"
                    aria-hidden="true"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" className="m-0.5 text-stone-900/70">
                      <path d="M13 3 3 13M13 7.5 7.5 13M13 11.5 11.5 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </span>
                )}
              </div>
            );
          })}
          {doors.map((d) => {
            const style: React.CSSProperties =
              d.side === "top"
                ? { left: `${d.pos}%`, top: 2, transform: "translateX(-50%)" }
                : d.side === "bottom"
                  ? { left: `${d.pos}%`, bottom: 2, transform: "translateX(-50%)" }
                  : d.side === "left"
                    ? { top: `${d.pos}%`, left: 2, transform: "translateY(-50%)" }
                    : { top: `${d.pos}%`, right: 2, transform: "translateY(-50%)" };
            const arrow = d.kind === "entry"
              ? { top: "↓", bottom: "↑", left: "→", right: "←" }[d.side]
              : { top: "↑", bottom: "↓", left: "←", right: "→" }[d.side];
            return (
              <button
                key={d.id}
                type="button"
                data-door={d.id}
                className={`absolute z-20 flex max-w-[45%] items-center gap-1 rounded-full border-2 border-white px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-white shadow ${
                  d.kind === "entry" ? "bg-brand-700" : "bg-amber-700"
                } ${editing ? "cursor-grab touch-none active:cursor-grabbing" : ""} ${selectedDoor === d.id ? "ring-2 ring-stone-900/60 ring-offset-1" : ""}`}
                style={style}
                onPointerDown={(e) => onDoorDown(e, d)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`${d.kind === "entry" ? "Entry" : "Exit"}: ${d.label}`}
                aria-pressed={selectedDoor === d.id}
              >
                <span aria-hidden="true">{arrow}</span>
                <span className="truncate">{d.label}</span>
              </button>
            );
          })}
          {areas.length === 0 && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-stone-600">
              {canEdit ? "Click Edit layout, then place your locations on the plan." : "No areas placed yet. Ask Warehouse or Admin to set up the plan."}
            </div>
          )}
        </div>
        <p className="text-xs text-stone-500">
          Areas are your stock locations. Pulsing = an item&apos;s home area. Amber = stock sitting outside its home area. Green pills are entries, amber pills are exits.
        </p>
      </div>

      <aside className="space-y-4">
        {door ? (
          <div className="card space-y-3 text-sm" data-testid="door-panel">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">{door.label}</h3>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold text-white ${door.kind === "entry" ? "bg-brand-700" : "bg-amber-700"}`}>
                {door.kind === "entry" ? "Entry" : "Exit"}
              </span>
            </div>
            <p className="text-stone-500">On the {door.side} wall.</p>
            {canEdit && editing ? (
              <form
                key={door.id + door.label + door.kind}
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  editDoor(door, { kind: String(fd.get("kind")) as PlanDoor["kind"], label: String(fd.get("label")).trim().replace(/\s+/g, " ") });
                }}
              >
                <label className="block">
                  <span className="label">Type</span>
                  <select name="kind" className="input" defaultValue={door.kind}>
                    <option value="entry">Entry</option>
                    <option value="exit">Exit</option>
                  </select>
                </label>
                <label className="block">
                  <span className="label">Label</span>
                  <input name="label" className="input" defaultValue={door.label} required maxLength={60} />
                </label>
                <div className="flex gap-2">
                  <button type="submit" className="btn btn-sm btn-primary">
                    Save
                  </button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => dropDoor(door)}>
                    Remove
                  </button>
                </div>
              </form>
            ) : (
              canEdit && <p className="text-xs text-stone-500">Click Edit layout to move, relabel or remove it.</p>
            )}
            <button type="button" className="btn btn-sm" onClick={() => setSelectedDoor(null)}>
              Close
            </button>
          </div>
        ) : item ? (
          <div className="card space-y-3">
            <div className="flex items-start gap-3">
              <ItemThumb path={item.image} name={item.name} category={item.category} size={56} />
              <div className="min-w-0">
                <Link href={`/products/${item.id}`} className="link font-semibold">
                  {item.name}
                </Link>
                <div className="text-xs text-stone-500 tabular-nums">{item.sku}</div>
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
