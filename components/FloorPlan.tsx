"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ItemThumb } from "./ItemThumb";
import { resizeImage } from "@/lib/resizeImage";
import { AREA_COLORS, type DoorSide, type PlanDoor } from "@/lib/plan";
import {
  angleOf,
  bbox,
  centroid,
  clamp,
  clampPts,
  feetScale,
  fitBox,
  fmtFt,
  insertPoint,
  rectPoints,
  removePoint,
  rotate,
  toSvg,
  translate,
  type Box,
  type Pt,
} from "@/lib/shapes";
import type { MapArea } from "./MiniMap";
import type { PlanSection } from "@/lib/plan";
import { SectionEditor, type SectionDraft } from "./SectionEditor";

/** A location's area, or a section's (parent = the section's location). */
export type PlanArea = MapArea & { parent?: string };
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
  sectionStock?: Record<string, number>; // section id → base qty recorded there
};
type Result = { error?: string } | void;
type Created = { error?: string; id?: string };
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type Drag =
  | { kind: "shape"; id: string; mode: "move"; start: Pt[]; p0: Pt; moved: boolean }
  | { kind: "shape"; id: string; mode: "vertex"; start: Pt[]; vi: number; moved: boolean }
  | { kind: "shape"; id: string; mode: "scale"; start: Pt[]; box: Box; handle: Handle; p0: Pt; moved: boolean }
  | { kind: "shape"; id: string; mode: "rotate"; start: Pt[]; a0: number; moved: boolean }
  | { kind: "door"; id: string; before: PlanDoor; moved: boolean };

const HANDLES: { h: Handle; fx: number; fy: number; cursor: string }[] = [
  { h: "nw", fx: 0, fy: 0, cursor: "nwse-resize" },
  { h: "n", fx: 0.5, fy: 0, cursor: "ns-resize" },
  { h: "ne", fx: 1, fy: 0, cursor: "nesw-resize" },
  { h: "e", fx: 1, fy: 0.5, cursor: "ew-resize" },
  { h: "se", fx: 1, fy: 1, cursor: "nwse-resize" },
  { h: "s", fx: 0.5, fy: 1, cursor: "ns-resize" },
  { h: "sw", fx: 0, fy: 1, cursor: "nesw-resize" },
  { h: "w", fx: 0, fy: 0.5, cursor: "ew-resize" },
];

const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n);
export function FloorPlan(props: {
  layout: { id: string; name: string };
  layouts: { id: string; name: string }[];
  doors: PlanDoor[];
  aspect: number;
  widthFt: number | null;
  heightFt: number | null;
  backgroundUrl: string | null;
  areas: PlanArea[];
  sections: PlanSection[];
  locations: PlanLocation[];
  items: PlanItem[];
  canEdit: boolean;
  canAssign: boolean;
  initialItem?: string | null;
  actions: {
    saveArea: (id: string, a: { points: Pt[]; color?: string }) => Promise<Result>;
    removeArea: (id: string) => Promise<Result>;
    setFloorSize: (layoutId: string, widthFt: number, heightFt: number) => Promise<Result & { aspect?: number }>;
    uploadBackground: (fd: FormData) => Promise<Result>;
    removeBackground: (layoutId: string) => Promise<Result>;
    setHome: (productId: string, layoutId: string, locationId: string | null) => Promise<Result>;
    createLayout: (name: string) => Promise<Created>;
    renameLayout: (id: string, name: string) => Promise<Result>;
    deleteLayout: (id: string, moveTo: string) => Promise<Result>;
    addDoor: (layoutId: string, d: { kind: string; label: string; side: string; pos: number }) => Promise<Created>;
    saveDoor: (id: string, d: { kind?: string; label?: string; side?: string; pos?: number }) => Promise<Result>;
    removeDoor: (id: string) => Promise<Result>;
    saveSection: (d: {
      id?: string;
      layoutId: string;
      locationId: string;
      newLocation?: string;
      name: string;
      shelves: string;
      place?: { points: Pt[]; color?: string } | null;
    }) => Promise<{ error?: string; id?: string; locationId?: string }>;
    deleteSection: (id: string) => Promise<Result>;
    renameLocation: (id: string, name: string) => Promise<Result>;
  };
}) {
  const { actions, canEdit, canAssign } = props;
  const layoutId = props.layout.id;
  const router = useRouter();
  const withSections = (a: PlanArea[], secs: PlanSection[]): PlanArea[] => [...a, ...secs.filter((x) => x.area).map((x) => ({ ...x.area!, parent: x.locationId }))];
  const [areas, setAreas] = useState<PlanArea[]>(() => withSections(props.areas, props.sections));
  const [secForm, setSecForm] = useState<null | { mode: "new"; locationId?: string } | { mode: "edit"; id: string } | { mode: "rename"; id: string }>(null);
  const [secError, setSecError] = useState<string | null>(null);
  const [doors, setDoors] = useState<PlanDoor[]>(props.doors);
  const [selectedDoor, setSelectedDoor] = useState<string | null>(null);
  const [layoutForm, setLayoutForm] = useState<null | "new" | "rename" | "delete">(null);
  const [items, setItems] = useState<PlanItem[]>(props.items);
  const [aspect, setAspect] = useState(props.aspect);
  const [feet, setFeet] = useState<{ w: number; h: number } | null>(props.widthFt && props.heightFt ? { w: props.widthFt, h: props.heightFt } : null);
  const [vertex, setVertex] = useState<number | null>(null);
  const [planPx, setPlanPx] = useState(800);
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
  const lastTap = useRef<{ key: string; at: number } | null>(null);
  const doorsRef = useRef(doors);
  doorsRef.current = doors;

  // handle sizes stay the same on screen whatever the plan's size
  useEffect(() => {
    const el = planRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPlanPx(el.getBoundingClientRect().width || 800));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const vbW = 100 * aspect;
  const u = vbW / planPx; // plan units per screen pixel
  const scale = feetScale(feet?.w, feet?.h);
  // snap to ½ ft when the floor size is set, else ½ % of the plan
  const stepX = scale ? 0.5 / scale.x : 0.5;
  const stepY = scale ? 0.5 / scale.y : 0.5;
  const snapX = (v: number) => Math.round(v / stepX) * stepX;
  const snapY = (v: number) => Math.round(v / stepY) * stepY;
  const sizeText = (b: Box) => (scale ? `${fmtFt(b.w * scale.x)} × ${fmtFt(b.h * scale.y)}` : `${Math.round(b.w)}% × ${Math.round(b.h)}%`);

  const locName = (id: string | null) => props.locations.find((l) => l.id === id)?.name ?? "—";
  const placedIds = new Set(areas.map((a) => a.id));
  const unplaced = props.locations.filter((l) => l.active && !placedIds.has(l.id));
  const unplacedSections = props.sections.filter((x) => !placedIds.has(x.id));
  const sectionOf = (id: string | null) => props.sections.find((x) => x.id === id) ?? null;
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
  const toPlanRaw = (e: { clientX: number; clientY: number }): Pt => {
    const box = planRef.current!.getBoundingClientRect();
    return [((e.clientX - box.left) / box.width) * 100, ((e.clientY - box.top) / box.height) * 100];
  };
  const toPlan = (e: { clientX: number; clientY: number }): Pt => {
    const [x, y] = toPlanRaw(e);
    return [clamp(x, 0, 100), clamp(y, 0, 100)];
  };
  function startShape(e: React.PointerEvent, d: Drag) {
    if (!editing || e.button > 0) return;
    e.preventDefault();
    e.stopPropagation();
    planRef.current?.setPointerCapture(e.pointerId);
    drag.current = d;
    setSelected(d.id);
    setSelectedDoor(null);
  }
  function onShapeDown(e: React.PointerEvent, a: PlanArea) {
    if (!editing) return;
    if (selected !== a.id) setVertex(null);
    startShape(e, { kind: "shape", id: a.id, mode: "move", start: a.points, p0: toPlan(e), moved: false });
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
  function setPoints(id: string, points: Pt[]) {
    setAreas((all) => all.map((a) => (a.id === id ? { ...a, points } : a)));
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
    const p = d.mode === "scale" ? toPlanRaw(e) : toPlan(e);
    d.moved = true;
    if (d.mode === "move") {
      const b = bbox(d.start);
      // snap the shape's top-left corner to the grid
      const dx = snapX(b.x + p[0] - d.p0[0]) - b.x;
      const dy = snapY(b.y + p[1] - d.p0[1]) - b.y;
      setPoints(d.id, translate(d.start, dx, dy));
    } else if (d.mode === "vertex") {
      setPoints(d.id, d.start.map((q, i) => (i === d.vi ? ([snapX(p[0]), snapY(p[1])] as Pt) : q)));
    } else if (d.mode === "scale") {
      const b = d.box;
      let x1 = b.x;
      let y1 = b.y;
      let x2 = b.x + b.w;
      let y2 = b.y + b.h;
      const minW = stepX * 2;
      const minH = stepY * 2;
      // the handle follows the pointer; sizes snap to ½ ft steps from the edge that stays put
      const dx = p[0] - d.p0[0];
      const dy = p[1] - d.p0[1];
      if (d.handle.includes("w")) x1 = x2 - Math.max(snapX(b.w - dx), minW);
      if (d.handle.includes("e")) x2 = x1 + Math.max(snapX(b.w + dx), minW);
      if (d.handle.includes("n")) y1 = y2 - Math.max(snapY(b.h - dy), minH);
      if (d.handle.includes("s")) y2 = y1 + Math.max(snapY(b.h + dy), minH);
      x1 = Math.max(0, x1);
      y1 = Math.max(0, y1);
      x2 = Math.min(100, x2);
      y2 = Math.min(100, y2);
      setPoints(d.id, fitBox(d.start, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }));
    } else if (d.mode === "rotate") {
      const c = centroid(d.start, aspect);
      let deg = angleOf(c, p, aspect) - d.a0;
      deg = e.shiftKey ? deg : Math.round(deg / 5) * 5;
      setPoints(d.id, rotate(d.start, deg, aspect));
    }
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
    saveShape(a, a.points, d.start);
  }
  function saveShape(a: PlanArea, points: Pt[], before: Pt[] = a.points) {
    const pts = clampPts(points);
    setPoints(a.id, pts);
    run(
      () => actions.saveArea(a.id, { points: pts }),
      () => setPoints(a.id, before),
    );
  }
  function onShapeKey(e: React.KeyboardEvent, a: PlanArea) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSelected(selected === a.id ? null : a.id);
      setSelectedDoor(null);
      return;
    }
    if (!editing) return;
    if ((e.key === "Delete" || e.key === "Backspace") && vertex !== null && selected === a.id) {
      e.preventDefault();
      deletePoint(a, vertex);
      return;
    }
    const step = e.shiftKey ? 5 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-stepX * step, 0],
      ArrowRight: [stepX * step, 0],
      ArrowUp: [0, -stepY * step],
      ArrowDown: [0, stepY * step],
    };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    setSelected(a.id);
    saveShape(a, translate(a.points, m[0], m[1]));
  }
  function deletePoint(a: PlanArea, i: number) {
    if (a.points.length <= 3) return setError("A shape needs at least 3 points.");
    setVertex(null);
    saveShape(a, removePoint(a.points, i));
  }

  /** Where a new area goes: inside its location's area for a section, else a 10 × 8 ft (or fifth of the plan) box in the middle. */
  function spotFor(parent?: string) {
    const pa = parent ? areas.find((x) => x.id === parent) : null;
    if (pa) {
      const pb = bbox(pa.points);
      const w = Math.max(stepX * 4, pb.w * 0.4);
      const h = Math.max(stepY * 4, pb.h * 0.5);
      return { points: clampPts(rectPoints(snapX(pb.x + pb.w / 2 - w / 2), snapY(pb.y + pb.h / 2 - h / 2), snapX(w), snapY(h))), color: pa.color };
    }
    const w = parent ? (scale ? Math.min(40, 6 / scale.x) : 14) : scale ? Math.min(60, 10 / scale.x) : 20;
    const h = parent ? (scale ? Math.min(40, 4 / scale.y) : 10) : scale ? Math.min(60, 8 / scale.y) : 16;
    return { points: clampPts(rectPoints(snapX(50 - w / 2), snapY(50 - h / 2), snapX(w), snapY(h))), color: AREA_COLORS[areas.length % AREA_COLORS.length] };
  }
  function place(loc: { id: string; name: string; parent?: string }) {
    const { points, color } = spotFor(loc.parent);
    const b = bbox(points);
    const a: PlanArea = { id: loc.id, name: loc.name, x: b.x, y: b.y, w: b.w, h: b.h, color, points, parent: loc.parent };
    setAreas((all) => [...all, a]);
    setSelected(loc.id);
    setVertex(null);
    run(
      () => actions.saveArea(loc.id, { points, color }),
      () => setAreas((all) => all.filter((x) => x.id !== loc.id)),
    );
  }
  function saveSectionDraft(d: SectionDraft) {
    setSecError(null);
    start(async () => {
      const r = await actions.saveSection({
        id: d.id,
        layoutId,
        locationId: d.locationId,
        newLocation: d.newLocation,
        name: d.name,
        shelves: d.shelves,
        place: !d.id && d.place ? spotFor(d.locationId === "__new" ? undefined : d.locationId) : null,
      });
      if (r.error) return setSecError(r.error);
      setSecForm(null);
      if (r.id) setSelected(r.id);
      setSelectedDoor(null);
      router.refresh();
    });
  }
  function renameLoc(id: string, name: string) {
    setSecError(null);
    start(async () => {
      const r = await actions.renameLocation(id, name);
      if (r && r.error) return setSecError(r.error);
      setSecForm(null);
      router.refresh();
    });
  }
  function dropSection(id: string) {
    if (!window.confirm("Delete this section? Stock and items that used it keep their location but lose this section and shelf.")) return;
    setSecError(null);
    start(async () => {
      const r = await actions.deleteSection(id);
      if (r && r.error) return setSecError(r.error);
      setSecForm(null);
      setSelected(null);
      setAreas((all) => all.filter((x) => x.id !== id));
      router.refresh();
    });
  }
  function recolor(a: PlanArea, color: string) {
    setAreas((all) => all.map((x) => (x.id === a.id ? { ...x, color } : x)));
    run(() => actions.saveArea(a.id, { points: a.points, color }));
  }
  function unplace(a: PlanArea) {
    setAreas((all) => all.filter((x) => x.id !== a.id));
    setSelected(null);
    run(() => actions.removeArea(a.id), () => setAreas((all) => [...all, a]));
  }
  function resizeTo(a: PlanArea, fd: FormData) {
    const b = bbox(a.points);
    const w = Number(fd.get("w"));
    const h = Number(fd.get("h"));
    if (!(w > 0 && h > 0)) return setError("Enter a width and depth greater than 0.");
    const wp = scale ? w / scale.x : w;
    const hp = scale ? h / scale.y : h;
    if (wp > 100.001 || hp > 100.001) return setError("That's bigger than the floor.");
    const x = clamp(b.x, 0, 100 - wp);
    const y = clamp(b.y, 0, 100 - hp);
    saveShape(a, fitBox(a.points, { x, y, w: wp, h: hp }));
  }
  function saveFloor(fd: FormData) {
    const w = Number(fd.get("width_ft"));
    const h = Number(fd.get("height_ft")) || (props.backgroundUrl ? w / aspect : 0);
    setError(null);
    start(async () => {
      const r = await actions.setFloorSize(layoutId, w, h);
      if (r && r.error) return setError(r.error);
      router.refresh();
    });
  }
  // the server re-reads shapes after a floor size change
  useEffect(() => {
    setAreas(withSections(props.areas, props.sections));
    setAspect(props.aspect);
    setFeet(props.widthFt && props.heightFt ? { w: props.widthFt, h: props.heightFt } : null);
  }, [props.areas, props.sections, props.aspect, props.widthFt, props.heightFt]); // eslint-disable-line react-hooks/exhaustive-deps
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
          {canEdit && editing && (
            <button type="button" className="btn" onClick={() => { setSecError(null); setSecForm({ mode: "new", locationId: area && !area.parent ? area.id : undefined }); }} data-testid="add-section">
              + Add section
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
            <p className="w-full text-stone-500">
              Drag an area to move it. Select it to get handles: corners and edges resize, the round handle on top rotates, the dots
              are its corners (drag them, double-click one to remove it) and the + on each edge adds a corner. Drag entries and exits along the
              walls.
            </p>
            <form
              key={`${feet?.w}-${feet?.h}-${aspect}`}
              className="flex flex-wrap items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                saveFloor(new FormData(e.currentTarget));
              }}
            >
              <span className="label mb-0">Floor size</span>
              <input
                name="width_ft"
                type="number"
                min="1"
                max="5000"
                step="0.5"
                required
                defaultValue={feet?.w ?? ""}
                placeholder="Width"
                className="input w-24 py-1 text-xs"
                aria-label="Floor width in feet"
              />
              <span className="text-stone-500">×</span>
              <input
                name="height_ft"
                type="number"
                min="1"
                max="5000"
                step="0.5"
                required={!props.backgroundUrl}
                disabled={!!props.backgroundUrl}
                defaultValue={feet?.h ?? ""}
                placeholder={props.backgroundUrl ? "From image" : "Depth"}
                className="input w-24 py-1 text-xs"
                aria-label="Floor depth in feet"
              />
              <span className="text-stone-500">ft</span>
              <button type="submit" className="btn btn-sm">
                {feet ? "Update" : "Set size"}
              </button>
            </form>
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
            {unplacedSections.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="label mb-0">Place section</span>
                {unplacedSections.map((x) => (
                  <button key={x.id} type="button" className="btn btn-sm" onClick={() => place({ id: x.id, name: x.name, parent: x.locationId })}>
                    + {x.name} <span className="text-stone-500">({locName(x.locationId)})</span>
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
          className={`relative w-full touch-none rounded-2xl border border-stone-200 bg-white select-none ${editing ? "ring-2 ring-brand-500/40" : ""}`}
          style={{ aspectRatio: String(aspect) }}
          onPointerDownCapture={() => {
            bgDown.current = false;
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
          {/* floor image and grid are clipped to the plan; handles may reach past its edge */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
          {props.backgroundUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={props.backgroundUrl} alt="Shop floor" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
          ) : scale ? null : (
            <div className="plan-grid pointer-events-none absolute inset-0" />
          )}
          {scale && !props.backgroundUrl && <FeetGrid aspect={aspect} widthFt={feet!.w} heightFt={feet!.h} />}
          </div>
          <svg
            viewBox={`0 0 ${vbW} 100`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full overflow-visible"
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) {
                bgDown.current = true;
                setVertex(null);
              }
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget && bgDown.current) {
                setSelected(null);
                setSelectedDoor(null);
              }
            }}
          >
            {areas.map((a) => {
              const mark = a.parent ? null : markFor(a);
              const dim = item && !mark;
              const isSel = selected === a.id;
              const count = stockIn[a.id]?.length ?? 0;
              return (
                <polygon
                  strokeDasharray={a.parent ? "5 3" : undefined}
                  key={a.id}
                  data-area={a.id}
                  points={toSvg(a.points, aspect)}
                  role="button"
                  tabIndex={0}
                  aria-label={a.parent ? `${a.name}, section in ${locName(a.parent)}` : `${a.name}${count ? `, ${count} items stored` : ""}`}
                  aria-pressed={isSel}
                  className={`plan-shape ${editing ? "cursor-move" : "cursor-pointer"} ${mark?.kind === "home" || mark?.kind === "home-stock" ? "shape-pulse" : ""}`}
                  style={{
                    fill: a.color,
                    fillOpacity: a.parent ? (isSel ? 0.42 : 0.3) : mark ? 0.36 : isSel ? 0.28 : 0.18,
                    stroke: mark?.kind === "away" ? "var(--color-amber-700)" : a.color,
                    strokeWidth: isSel ? 3 : 2,
                    opacity: dim ? 0.35 : 1,
                  }}
                  vectorEffect="non-scaling-stroke"
                  strokeLinejoin="round"
                  onPointerDown={(e) => onShapeDown(e, a)}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedDoor(null);
                    if (!editing) setSelected(isSel ? null : a.id);
                  }}
                  onKeyDown={(e) => onShapeKey(e, a)}
                />
              );
            })}
            {editing &&
              area &&
              (() => {
                const b = bbox(area.points);
                const r = 6 * u;
                const hs = 9 * u;
                // the resize frame sits a little outside the shape so its handles never cover the corner dots
                const pad = 14 * u;
                const f = { x: b.x * aspect - pad, y: b.y - pad, w: b.w * aspect + pad * 2, h: b.h + pad * 2 };
                // rotate handle above the shape, or below it when the shape touches the top wall
                const top = f.y - 18 * u > 1.5 ? f.y - 18 * u : f.y + f.h + 18 * u;
                const edgeY = top < f.y ? f.y : f.y + f.h;
                const cxU = (b.x + b.w / 2) * aspect;
                return (
                  <g data-handles={area.id}>
                    <rect
                      x={f.x}
                      y={f.y}
                      width={f.w}
                      height={f.h}
                      rx={4 * u}
                      fill="none"
                      stroke="var(--color-stone-500)"
                      strokeDasharray="4 3"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                    <line x1={cxU} y1={edgeY} x2={cxU} y2={top} stroke="var(--color-stone-500)" vectorEffect="non-scaling-stroke" pointerEvents="none" />
                    <circle
                      data-rotate={area.id}
                      cx={cxU}
                      cy={top}
                      r={r * 1.15}
                      className="plan-handle cursor-grab"
                      onPointerDown={(e) =>
                        startShape(e, { kind: "shape", id: area.id, mode: "rotate", start: area.points, a0: angleOf(centroid(area.points, aspect), toPlan(e), aspect), moved: false })
                      }
                    >
                      <title>Drag to rotate</title>
                    </circle>
                    {HANDLES.map((h) => (
                      <rect
                        key={h.h}
                        data-scale={h.h}
                        x={f.x + f.w * h.fx - hs / 2}
                        y={f.y + f.h * h.fy - hs / 2}
                        width={hs}
                        height={hs}
                        rx={2 * u}
                        className="plan-handle plan-handle-square"
                        style={{ cursor: h.cursor }}
                        onPointerDown={(e) =>
                          startShape(e, { kind: "shape", id: area.id, mode: "scale", start: area.points, box: b, handle: h.h, p0: toPlanRaw(e), moved: false })
                        }
                      />
                    ))}
                    {area.points.map((pt, i) => {
                      const nx = area.points[(i + 1) % area.points.length];
                      return (
                        <g key={i}>
                          <g
                            data-add={i}
                            className="plan-add cursor-copy"
                            onPointerDown={(e) => {
                              const next = insertPoint(area.points, i);
                              setPoints(area.id, next);
                              setVertex(i + 1);
                              startShape(e, { kind: "shape", id: area.id, mode: "vertex", start: next, vi: i + 1, moved: true });
                            }}
                          >
                            <circle cx={((pt[0] + nx[0]) / 2) * aspect} cy={(pt[1] + nx[1]) / 2} r={r * 0.9} />
                            <path
                              d={`M${((pt[0] + nx[0]) / 2) * aspect - r * 0.5} ${(pt[1] + nx[1]) / 2}h${r}M${((pt[0] + nx[0]) / 2) * aspect} ${(pt[1] + nx[1]) / 2 - r * 0.5}v${r}`}
                              vectorEffect="non-scaling-stroke"
                            />
                            <title>Drag to add a corner here</title>
                          </g>
                          <circle
                            data-vertex={i}
                            cx={pt[0] * aspect}
                            cy={pt[1]}
                            r={r}
                            className={`plan-handle cursor-move ${vertex === i ? "plan-handle-on" : ""}`}
                            onPointerDown={(e) => {
                              // a second tap on the same corner within ⅓ s removes it (works with mouse and touch)
                              const key = `${area.id}:${i}`;
                              const now = e.timeStamp;
                              if (lastTap.current && lastTap.current.key === key && now - lastTap.current.at < 350) {
                                lastTap.current = null;
                                e.preventDefault();
                                e.stopPropagation();
                                deletePoint(area, i);
                                return;
                              }
                              lastTap.current = { key, at: now };
                              setVertex(i);
                              startShape(e, { kind: "shape", id: area.id, mode: "vertex", start: area.points, vi: i, moved: false });
                            }}
                          >
                            <title>Drag to move this corner; double-click to remove it</title>
                          </circle>
                        </g>
                      );
                    })}
                  </g>
                );
              })()}
          </svg>
          {areas.map((a) => {
            const mark = a.parent ? null : markFor(a);
            const count = stockIn[a.id]?.length ?? 0;
            const [cx, cy] = centroid(a.points, aspect);
            const isSel = selected === a.id;
            if (a.parent) {
              const sec = sectionOf(a.id);
              const n = items.filter((i) => (i.sectionStock?.[a.id] ?? 0) > 0).length;
              const shelves = sec?.shelves.length ?? 0;
              return (
                <div
                  key={a.id}
                  className={`pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center ${item ? "opacity-35" : ""}`}
                  style={{ left: `${cx}%`, top: `${cy}%` }}
                  aria-hidden="true"
                >
                  <span className="text-[11px] leading-tight font-semibold whitespace-nowrap text-stone-900">{a.name}</span>
                  <span className="text-[10px] whitespace-nowrap text-stone-700">
                    {editing && isSel ? sizeText(bbox(a.points)) : `${shelves ? `${shelves} shel${shelves === 1 ? "f" : "ves"}` : "No shelves"}${n ? ` · ${n} item${n === 1 ? "" : "s"}` : ""}`}
                  </span>
                </div>
              );
            }
            return (
              <div
                key={a.id}
                className={`pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center ${item && !mark ? "opacity-35" : ""}`}
                style={{ left: `${cx}%`, top: `${cy}%` }}
                aria-hidden="true"
              >
                <span className="text-xs leading-tight font-semibold whitespace-nowrap text-stone-900">{a.name}</span>
                <span className="text-[11px] whitespace-nowrap text-stone-700">
                  {editing && isSel ? sizeText(bbox(a.points)) : count ? `${count} item${count === 1 ? "" : "s"}` : "Empty"}
                </span>
                {mark && (
                  <span
                    className={`mt-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${
                      mark.kind === "away" ? "bg-amber-50 text-amber-800" : "bg-brand-50 text-brand-800"
                    }`}
                  >
                    {mark.kind === "home" ? "Home · none here" : mark.kind === "home-stock" ? `Home · ${fmt(mark.q)}` : `${fmt(mark.q)} here`}
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
              {canEdit ? (editing ? "Tap + Add section to put the first section on the plan." : "Click Edit layout, then tap + Add section.") : "No areas placed yet. Ask Warehouse or Admin to set up the plan."}
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
          <div className="card space-y-3" data-testid={area.parent ? "section-panel" : "area-panel"}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">{area.name}</h3>
              <span className="h-3 w-3 rounded-full" style={{ background: area.color }} aria-hidden="true" />
            </div>
            {area.parent ? (
              <>
                <p className="text-sm text-stone-500">
                  Section in <b className="text-stone-800">{locName(area.parent)}</b>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(sectionOf(area.id)?.shelves ?? []).length ? (
                    sectionOf(area.id)!.shelves.map((x) => (
                      <span key={x} className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs text-stone-700">
                        Shelf {x}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-stone-500">No shelves yet.</span>
                  )}
                </div>
                {canEdit && (
                  <button type="button" className="btn btn-sm" onClick={() => { setSecError(null); setSecForm({ mode: "edit", id: area.id }); }} data-testid="edit-section">
                    Edit section
                  </button>
                )}
              </>
            ) : (
              canEdit && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" className="btn btn-sm" onClick={() => { setSecError(null); setSecForm({ mode: "rename", id: area.id }); }} data-testid="rename-location">
                      Rename
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => { setSecError(null); setEditing(true); setSecForm({ mode: "new", locationId: area.id }); }}>
                      + Add section here
                    </button>
                  </div>
                  {props.sections.some((x) => x.locationId === area.id) && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="label mb-0">Sections</span>
                      {props.sections
                        .filter((x) => x.locationId === area.id)
                        .map((x) => (
                          <button key={x.id} type="button" className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs text-stone-700 hover:bg-stone-200" onClick={() => setSelected(x.id)}>
                            {x.name}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )
            )}
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
                <form
                  key={area.points.map((p) => p.join(",")).join(" ") + (scale ? "ft" : "%")}
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    resizeTo(area, new FormData(e.currentTarget));
                  }}
                >
                  <label>
                    <span className="label">Width {scale ? "(ft)" : "(%)"}</span>
                    <input
                      name="w"
                      type="number"
                      step="0.5"
                      min="0.5"
                      className="input w-24"
                      defaultValue={Math.round(bbox(area.points).w * (scale ? scale.x : 1) * 2) / 2}
                    />
                  </label>
                  <label>
                    <span className="label">Depth {scale ? "(ft)" : "(%)"}</span>
                    <input
                      name="h"
                      type="number"
                      step="0.5"
                      min="0.5"
                      className="input w-24"
                      defaultValue={Math.round(bbox(area.points).h * (scale ? scale.y : 1) * 2) / 2}
                    />
                  </label>
                  <button type="submit" className="btn btn-sm">
                    Set size
                  </button>
                </form>
                {!scale && <p className="text-xs text-stone-500">Set the floor size above to work in feet.</p>}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="label mb-0">Rotate</span>
                  {[-90, -15, 15, 90].map((deg) => (
                    <button key={deg} type="button" className="btn btn-sm" onClick={() => saveShape(area, rotate(area.points, deg, aspect))} aria-label={`Rotate ${deg}°`}>
                      {deg < 0 ? "↺" : "↻"} {Math.abs(deg)}°
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" className="btn btn-sm" onClick={() => {
                    const b = bbox(area.points);
                    setVertex(null);
                    saveShape(area, rectPoints(b.x, b.y, b.w, b.h));
                  }}>
                    Make rectangle
                  </button>
                  {vertex !== null && area.points.length > 3 && (
                    <button type="button" className="btn btn-sm" onClick={() => deletePoint(area, vertex)}>
                      Remove corner
                    </button>
                  )}
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => unplace(area)}>
                    Remove from plan
                  </button>
                </div>
                <p className="text-xs text-stone-500">{area.points.length} corners · {sizeText(bbox(area.points))}</p>
              </div>
            )}
            {area.parent ? (
              <div>
                <div className="label">Recorded here</div>
                {items.filter((i) => (i.sectionStock?.[area.id] ?? 0) > 0).length === 0 ? (
                  <p className="text-sm text-stone-500">No stock recorded in this section. Set a lot&apos;s section and shelf on its page.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {items
                      .filter((i) => (i.sectionStock?.[area.id] ?? 0) > 0)
                      .map((it) => (
                        <li key={it.id} className="flex items-center gap-2 text-sm">
                          <ItemThumb path={it.image} name={it.name} category={it.category} size={28} />
                          <button type="button" className="link min-w-0 flex-1 truncate text-left" onClick={() => setFound(it.id)}>
                            {it.name}
                          </button>
                          <span className="tabular-nums">
                            {fmt(it.sectionStock![area.id])} {it.baseUnit}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            ) : (
            <>
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
            </>
            )}
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
      {secForm && (
        <SectionEditor
          key={JSON.stringify(secForm)}
          mode={secForm.mode}
          locations={props.locations.filter((l) => l.active).map((l) => ({ id: l.id, name: l.name }))}
          initial={
            secForm.mode === "new"
              ? { locationId: secForm.locationId }
              : secForm.mode === "rename"
                ? { id: secForm.id, name: locName(secForm.id) }
                : { id: secForm.id, locationId: sectionOf(secForm.id)?.locationId, name: sectionOf(secForm.id)?.name, shelves: sectionOf(secForm.id)?.shelves }
          }
          error={secError}
          pending={pending}
          onSave={saveSectionDraft}
          onRename={renameLoc}
          onDelete={secForm.mode === "edit" ? () => dropSection(secForm.id) : undefined}
          onClose={() => setSecForm(null)}
        />
      )}
    </div>
  );
}

/** Grid in feet: a line every foot (every 5 ft on big floors), stronger every 10 ft. */
function FeetGrid({ aspect, widthFt, heightFt }: { aspect: number; widthFt: number; heightFt: number }) {
  const vbW = 100 * aspect;
  const perFt = 100 / heightFt; // plan units per foot (same across and down)
  const minor = Math.max(widthFt, heightFt) > 80 ? 5 : 1;
  const lines: React.ReactNode[] = [];
  for (let f = minor; f < widthFt; f += minor) {
    const x = f * perFt;
    lines.push(<line key={`x${f}`} x1={x} y1={0} x2={x} y2={100} className={f % 10 === 0 ? "grid-major" : "grid-minor"} vectorEffect="non-scaling-stroke" />);
  }
  for (let f = minor; f < heightFt; f += minor) {
    const y = f * perFt;
    lines.push(<line key={`y${f}`} x1={0} y1={y} x2={vbW} y2={y} className={f % 10 === 0 ? "grid-major" : "grid-minor"} vectorEffect="non-scaling-stroke" />);
  }
  return (
    <svg viewBox={`0 0 ${vbW} 100`} preserveAspectRatio="none" className="plan-feet pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      {lines}
    </svg>
  );
}
