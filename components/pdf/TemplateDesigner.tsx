"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DOCS, FIELDS, sampleData } from "@/lib/pdfdocs/defaults";
import { fill, getField } from "@/lib/pdfdocs/render";
import type { Column, DocType, El, Template } from "@/lib/pdfdocs/types";
import { PdfModal } from "./PdfViewer";

type Business = { name: string; address: string; phone: string; footer: string };
type Result = { error?: string } | void;

const LABELS: DocType[] = ["label", "boxlabel"];
const uid = () => "e" + Math.random().toString(36).slice(2, 9);
const r1 = (n: number) => Math.round(n * 2) / 2;

/**
 * The PDF layout designer: one page per printout. Drag things to move them, the corner to resize,
 * pick one to change its words, size, font and when it shows. Preview makes the real PDF with sample data.
 */
export function TemplateDesigner({
  initial,
  defaults,
  business,
  onSave,
  onReset,
  build,
  workerSrc,
  labelSize,
}: {
  initial: Record<DocType, Template>;
  defaults: Record<DocType, Template>;
  business: Business;
  onSave: (doc: DocType, t: Template) => Promise<Result>;
  onReset: (doc: DocType) => Promise<Result>;
  /** renderDoc / renderLabels, passed in so the demo and app share one engine */
  build: (t: Template, sample: ReturnType<typeof sampleData>) => Promise<Uint8Array>;
  workerSrc?: string;
  /** the label size this device prints, to offer "match my label size" */
  labelSize?: { w: number; h: number };
}) {
  const [doc, setDoc] = useState<DocType>("pull");
  const [tpls, setTpls] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [sel, setSel] = useState<string | null>(null);
  const [hist, setHist] = useState<Template[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(0);
  const t = tpls[doc];
  const dirty = JSON.stringify(t) !== JSON.stringify(saved[doc]);
  const sample = useMemo(() => sampleData(doc, business), [doc, business]);
  const el = t.elements.find((e) => e.id === sel) ?? null;
  const table = t.elements.find((e) => e.type === "table");

  const change = useCallback(
    (next: Template, keepHistory = true) => {
      if (keepHistory) setHist((h) => [...h.slice(-49), tpls[doc]]);
      setTpls((all) => ({ ...all, [doc]: next }));
      setMsg(null);
    },
    [doc, tpls],
  );
  const patch = (id: string, p: Partial<El>, keep = true) => change({ ...t, elements: t.elements.map((e) => (e.id === id ? { ...e, ...p } : e)) }, keep);
  const undo = () => {
    const prev = hist[hist.length - 1];
    if (!prev) return;
    setHist((h) => h.slice(0, -1));
    setTpls((all) => ({ ...all, [doc]: prev }));
  };
  const add = (e: Partial<El> & Pick<El, "type" | "name">) => {
    const n: El = { id: uid(), x: 40, y: 40, w: 160, h: 16, size: 10, ...e };
    change({ ...t, elements: [...t.elements, n] });
    setSel(n.id);
  };
  const remove = (id: string) => {
    change({ ...t, elements: t.elements.filter((e) => e.id !== id) });
    setSel(null);
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
      if (!el) return;
      const step = e.shiftKey ? 10 : 1;
      const mv: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (mv[e.key]) { e.preventDefault(); patch(el.id, { x: el.x + mv[e.key][0], y: el.y + mv[e.key][1] }); }
      if ((e.key === "Delete" || e.key === "Backspace") && el.type !== "table") { e.preventDefault(); remove(el.id); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  async function save() {
    setBusy(true);
    const r = await onSave(doc, t);
    setBusy(false);
    if (r && r.error) return setMsg({ ok: false, text: r.error });
    setSaved((s) => ({ ...s, [doc]: t }));
    setMsg({ ok: true, text: "Saved. Every new PDF uses this layout." });
  }
  async function reset() {
    if (!confirm("Go back to the original layout for this printout? Your changes to it are removed.")) return;
    setBusy(true);
    const r = await onReset(doc);
    setBusy(false);
    if (r && r.error) return setMsg({ ok: false, text: r.error });
    setTpls((a) => ({ ...a, [doc]: defaults[doc] }));
    setSaved((a) => ({ ...a, [doc]: defaults[doc] }));
    setHist([]);
    setSel(null);
    setMsg({ ok: true, text: "Back to the original layout." });
  }
  function matchLabel() {
    if (!labelSize) return;
    const W = labelSize.w * 72, H = labelSize.h * 72, sx = W / t.page.w, sy = H / t.page.h, fs = Math.min(sx, sy);
    change({ ...t, page: { w: W, h: H }, elements: t.elements.map((e) => ({ ...e, x: r1(e.x * sx), y: r1(e.y * sy), w: r1(e.w * sx), h: r1(e.h * sy), size: e.size ? Math.round(e.size * fs * 10) / 10 : e.size })) });
  }
  function onImage(file: File | undefined) {
    if (!file) return;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 700, r = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * r));
      c.height = Math.max(1, Math.round(img.height * r));
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      const src = c.toDataURL("image/png");
      URL.revokeObjectURL(url);
      const h = 48, w = Math.min(200, Math.round((h * c.width) / c.height));
      const logo = t.elements.find((e) => e.type === "image" && !e.src);
      if (logo) { patch(logo.id, { src, w, h, hidden: false }); setSel(logo.id); } else add({ type: "image", name: "Logo", src, w, h, x: 36, y: 30 });
    };
    img.onerror = () => setMsg({ ok: false, text: "That picture couldn't be read. Use a PNG or JPEG." });
    img.src = url;
  }

  return (
    <div className="pdfd" data-testid="pdf-designer">
      <div className="pdfd-tabs" role="tablist" aria-label="Printouts">
        {DOCS.map((d) => (
          <button key={d.doc} type="button" role="tab" aria-selected={d.doc === doc} className={`pdfd-tab ${d.doc === doc ? "on" : ""}`} onClick={() => { setDoc(d.doc); setSel(null); setHist([]); setMsg(null); }}>
            {d.label}
            {JSON.stringify(tpls[d.doc]) !== JSON.stringify(saved[d.doc]) && <span className="pdfd-dot" aria-label="unsaved changes" />}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-stone-500">{DOCS.find((d) => d.doc === doc)!.hint}{LABELS.includes(doc) ? ` · laid out at ${(t.page.w / 72).toFixed(2)} × ${(t.page.h / 72).toFixed(2)} in, and scaled to the label size you print` : ""}</p>

      <div className="pdfd-bar">
        <select className="input w-auto" value="" onChange={(e) => { const f = FIELDS[doc].find((x) => x.key === e.target.value); if (f) add({ type: "text", name: f.label, text: `{${f.key}}` }); }} aria-label="Add a field" data-testid="add-field">
          <option value="">+ Field…</option>
          {FIELDS[doc].map((f) => (
            <option key={f.key} value={f.key}>{f.label}</option>
          ))}
        </select>
        <button type="button" className="btn" onClick={() => add({ type: "text", name: "Text", text: "New text" })} data-testid="add-text">+ Text</button>
        <button type="button" className="btn" onClick={() => add({ type: "line", name: "Line", h: 2, w: 200, stroke: 1 })}>+ Line</button>
        <button type="button" className="btn" onClick={() => add({ type: "box", name: "Box", w: 160, h: 60, stroke: 1 })}>+ Box</button>
        {!LABELS.includes(doc) && <button type="button" className="btn" onClick={() => add({ type: "signature", name: "Signature", w: 220, h: 36, text: "Signature" })}>+ Signature</button>}
        <label className="btn relative cursor-pointer overflow-hidden">
          + Logo / picture
          <input type="file" accept="image/png,image/jpeg" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }} onChange={(e) => onImage(e.target.files?.[0])} aria-label="Add a logo or picture" />
        </label>
        <button type="button" className="btn" onClick={() => add({ type: "barcode", name: "Barcode", text: FIELDS[doc].find((f) => /number|code/i.test(f.key))?.key ? `{${FIELDS[doc].find((f) => /number|code/i.test(f.key))!.key}}` : "", w: 160, h: 34 })}>+ Barcode</button>
        <span className="grow" />
        <button type="button" className="btn" onClick={undo} disabled={!hist.length} title="Undo (Ctrl+Z)">Undo</button>
        <button type="button" className="btn" onClick={() => setPreview((p) => p + 1)} data-testid="preview-pdf">Preview PDF</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={!dirty || busy} data-testid="save-layout">{busy ? "Saving…" : "Save layout"}</button>
      </div>
      {msg && <div role="status" className={`mt-2 rounded-md px-3 py-2 text-sm ${msg.ok ? "bg-brand-50 text-brand-800" : "bg-red-50 text-red-800"}`}>{msg.text}</div>}

      <div className="pdfd-main">
        <Canvas t={t} sample={sample} sel={sel} onSelect={setSel} onMove={(id, p, keep) => patch(id, p, keep)} onBegin={() => setHist((h) => [...h.slice(-49), tpls[doc]])} table={table} />
        <aside className="pdfd-side">
          {el ? (
            <Props el={el} doc={doc} onChange={(p) => patch(el.id, p)} onRemove={() => remove(el.id)} onClose={() => setSel(null)} />
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-stone-500">Tap anything on the page to change it. Drag to move it, drag its corner to resize. Arrow keys nudge it (Shift for bigger steps). Things that only print on later pages are faint; pick them from the list below.</p>
              {LABELS.includes(doc) && labelSize && Math.abs(labelSize.w * 72 - t.page.w) + Math.abs(labelSize.h * 72 - t.page.h) > 2 && (
                <button type="button" className="btn w-full" onClick={matchLabel}>Lay out at my label size ({labelSize.w} × {labelSize.h} in)</button>
              )}
            </div>
          )}
          <h3 className="mt-5 mb-1.5 text-xs font-semibold tracking-wide text-stone-500 uppercase">On this printout</h3>
          <ul className="pdfd-list" data-testid="layer-list">
            {t.elements.map((e) => (
              <li key={e.id} className={e.id === sel ? "on" : ""}>
                <button type="button" className="grow truncate text-left" onClick={() => setSel(e.id)}>{e.name}{e.when ? <span className="text-stone-400"> · if set</span> : null}</button>
                <button type="button" className="pdfd-eye" aria-pressed={!e.hidden} aria-label={`${e.hidden ? "Show" : "Hide"} ${e.name}`} onClick={() => patch(e.id, { hidden: !e.hidden })}>{e.hidden ? "Hidden" : "Shown"}</button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn mt-4 w-full" onClick={reset} disabled={busy} data-testid="reset-layout">Back to the original layout</button>
        </aside>
      </div>
      <PdfModal open={preview > 0} onClose={() => setPreview(0)} title={`Preview · ${DOCS.find((d) => d.doc === doc)!.label}`} build={() => build(t, sample)} buildKey={String(preview) + JSON.stringify(t).length} filename={`${doc}-preview.pdf`} workerSrc={workerSrc} />
    </div>
  );
}

/* ------------------------------------------------------------------ canvas */

function Canvas({ t, sample, sel, onSelect, onMove, onBegin, table }: { t: Template; sample: ReturnType<typeof sampleData>; sel: string | null; onSelect: (id: string | null) => void; onMove: (id: string, p: Partial<El>, keep: boolean) => void; onBegin: () => void; table: El | undefined }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(600);
  useEffect(() => {
    const e = wrap.current;
    if (!e) return;
    const ro = new ResizeObserver(() => setCw(e.clientWidth));
    ro.observe(e);
    setCw(e.clientWidth);
    return () => ro.disconnect();
  }, []);
  const k = Math.min(cw / t.page.w, t.page.w < 400 ? 2.6 : 1.4);
  const fields = { ...sample.fields, copy: sample.copies?.[0] ?? "", page: "1", pages: "1" };
  const afterTop = table ? table.y + table.h : 0;
  const afterLeft = table ? table.x : 0;

  const drag = (e: React.PointerEvent, el: El, mode: "move" | "size") => {
    e.stopPropagation();
    e.preventDefault();
    onSelect(el.id);
    onBegin();
    const sx = e.clientX, sy = e.clientY, o = { x: el.x, y: el.y, w: el.w, h: el.h };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / k, dy = (ev.clientY - sy) / k;
      onMove(el.id, mode === "move" ? { x: r1(o.x + dx), y: r1(o.y + dy) } : { w: r1(Math.max(4, o.w + dx)), h: r1(Math.max(2, o.h + dy)) }, false);
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div ref={wrap} className="pdfd-canvas-wrap">
      <div className="pdfd-page" style={{ width: t.page.w * k, height: t.page.h * k }} onPointerDown={() => onSelect(null)} data-testid="design-page">
        {table && <div className="pdfd-after-guide" style={{ top: afterTop * k }} aria-hidden="true"><span style={{ fontSize: Math.max(7, 9 * k) }}>Below the lines (moves down as the list grows)</span></div>}
        {t.elements.filter((el) => !(el.hidden && (el.w <= 0 || el.h <= 0))).map((el) => {
          const ox = el.flow === "after" ? afterLeft : 0, oy = el.flow === "after" ? afterTop : 0;
          const off = el.when && !getField(fields, el.when) ? true : false;
          return (
            <div
              key={el.id}
              className={`pdfd-el pdfd-${el.type} ${el.id === sel ? "sel" : ""} ${el.hidden ? "hid" : ""} ${off ? "cond" : ""} ${el.pages === "rest" ? "rest" : ""}`}
              style={{ left: (el.x + ox) * k, top: (el.y + oy) * k, width: Math.max(el.w, 4) * k, height: Math.max(el.h, 2) * k }}
              onPointerDown={(e) => drag(e, el, "move")}
              data-el={el.id}
              title={el.name}
            >
              <Preview el={el} fields={fields} k={k} rows={sample.rows} />
              {el.id === sel && <span className="pdfd-handle" onPointerDown={(e) => drag(e, el, "size")} aria-label="Resize" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Preview({ el, fields, k, rows }: { el: El; fields: Record<string, unknown>; k: number; rows?: ReturnType<typeof sampleData>["rows"] }) {
  const style: React.CSSProperties = {
    fontSize: (el.size || 10) * k,
    fontWeight: el.bold ? 700 : 400,
    fontFamily: el.mono ? "Courier New, monospace" : "Helvetica, Arial, sans-serif",
    fontStyle: el.italic ? "italic" : undefined,
    textTransform: el.upper ? "uppercase" : undefined,
    textAlign: el.align || "left",
    color: el.color || "#111",
    lineHeight: 1.18,
    whiteSpace: "pre-wrap",
  };
  switch (el.type) {
    case "text":
    case "pagenum":
      return <div style={style} className="pdfd-text">{fill(el.text || "", fields) || <span className="pdfd-empty">{el.text}</span>}</div>;
    case "barcode":
      return <div className="pdfd-bars" />;
    case "line":
      return <div style={{ position: "absolute", inset: 0, display: "grid", alignItems: "center" }}><div style={el.h > el.w ? { width: Math.max(1, (el.stroke ?? 1) * k), height: "100%", margin: "0 auto", background: el.color || "#111" } : { height: Math.max(1, (el.stroke ?? 1) * k), background: el.color || "#111" }} /></div>;
    case "box":
      return <div style={{ position: "absolute", inset: 0, border: el.stroke ? `${Math.max(1, el.stroke * k)}px solid ${el.color || "#111"}` : undefined, background: el.fill, padding: 4 * k, ...style }}>{fill(el.text || "", fields)}</div>;
    case "image":
      return el.src ? <img src={el.src} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: el.align === "right" ? "right" : el.align === "center" ? "center" : "left" }} draggable={false} /> : <div className="pdfd-empty p-1 text-[10px]">Logo: use + Logo / picture</div>;
    case "mustcheck":
      return (
        <div style={{ position: "absolute", inset: 0, border: `${2 * k}px solid ${el.color || "#c62828"}`, color: el.color || "#c62828", display: "grid", gridTemplateRows: "1fr auto", padding: 6 * k, fontFamily: "Helvetica, Arial, sans-serif" }}>
          <b style={{ fontSize: (el.size || 18) * k, textAlign: "center" }}>MUST CHECK</b>
          <span style={{ borderTop: `${k}px solid currentColor`, fontSize: 7 * k, fontWeight: 700, paddingTop: 2 * k }}>SIGNATURE</span>
        </div>
      );
    case "signature":
      return <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, borderTop: `${Math.max(1, k * 0.8)}px solid #111`, fontSize: (el.size || 8) * k, fontWeight: 700, color: "#57534e", fontFamily: "Helvetica, Arial, sans-serif", paddingTop: 2 * k }}>{fill(el.text || "", fields)}</div>;
    case "table": {
      const cols = (el.columns || []).filter((c) => !c.hidden);
      const sum = cols.reduce((a, c) => a + c.w, 0) || 1;
      const fs = (el.rowSize || 9.5) * k;
      const sampleRows = (rows || []).slice(0, 8);
      return (
        <div style={{ position: "absolute", inset: 0, overflow: "hidden", fontFamily: "Helvetica, Arial, sans-serif", fontSize: fs, color: "#111" }}>
          <div style={{ display: "flex", borderBottom: "1px solid #a8a29e", color: "#57534e", fontWeight: 700, fontSize: fs * 0.86, padding: `${3 * k}px 0` }}>
            {cols.map((c) => <div key={c.key} style={{ width: `${(c.w / sum) * 100}%`, padding: `0 ${3 * k}px`, textAlign: c.align || "left", whiteSpace: "nowrap", overflow: "hidden" }}>{c.label}</div>)}
          </div>
          {sampleRows.map((r, i) =>
            r._group !== undefined ? (
              <div key={i} style={{ background: r._tone === "warn" ? "#fef3c7" : "#f0efed", fontWeight: 700, textTransform: "uppercase", padding: `${3 * k}px ${6 * k}px` }}>{r._group}</div>
            ) : (
              <div key={i} style={{ display: "flex", borderBottom: "1px solid #e7e5e4", padding: `${3 * k}px 0` }}>
                {cols.map((c) => (
                  <div key={c.key} style={{ width: `${(c.w / sum) * 100}%`, padding: `0 ${3 * k}px`, textAlign: c.align || "left", fontWeight: c.bold ? 700 : 400, fontFamily: c.kind === "mono" ? "Courier New, monospace" : undefined, overflow: "hidden" }}>
                    {c.kind === "check" ? <span style={{ display: "inline-block", width: 9 * k, height: 9 * k, border: `${k}px solid #111` }} /> : c.kind === "blank" ? <span style={{ display: "block", borderBottom: "1px solid #57534e", height: fs * 1.6 }} /> : String(r[c.key] ?? "")}
                    {c.sub && r[c.sub] ? <div style={{ fontSize: fs * 0.82, color: "#57534e", fontWeight: 400 }}>{String(r[c.sub])}</div> : null}
                  </div>
                ))}
              </div>
            ),
          )}
        </div>
      );
    }
  }
}

/* ------------------------------------------------------------------ properties */

function Props({ el, doc, onChange, onRemove, onClose }: { el: El; doc: DocType; onChange: (p: Partial<El>) => void; onRemove: () => void; onClose: () => void }) {
  const txt = el.type === "text" || el.type === "pagenum" || el.type === "box" || el.type === "signature" || el.type === "barcode";
  const num = (k: "x" | "y" | "w" | "h", label: string) => (
    <label className="block">
      <span className="label">{label}</span>
      <input type="number" step="0.5" className="input" value={el[k]} onChange={(e) => onChange({ [k]: Number(e.target.value) || 0 })} />
    </label>
  );
  return (
    <div className="space-y-3" data-testid="el-props">
      <div className="flex items-center justify-between gap-2">
        <input className="input font-medium" value={el.name} onChange={(e) => onChange({ name: e.target.value })} aria-label="Name" />
        <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Done">✓</button>
      </div>
      {txt && (
        <label className="block">
          <span className="label">{el.type === "barcode" ? "Value" : el.type === "signature" ? "Caption" : "Words"} (fields in {"{curly brackets}"})</span>
          <textarea className="input font-mono text-xs" rows={el.type === "barcode" ? 1 : 3} value={el.text || ""} onChange={(e) => onChange({ text: e.target.value })} data-testid="el-text" />
          <select className="input mt-1" value="" onChange={(e) => e.target.value && onChange({ text: (el.text || "") + `{${e.target.value}}` })} aria-label="Insert a field">
            <option value="">Insert a field…</option>
            {FIELDS[doc].map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </label>
      )}
      {(el.type === "text" || el.type === "pagenum" || el.type === "box" || el.type === "signature" || el.type === "mustcheck") && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="label">Text size</span>
            <input type="number" min="4" max="72" step="0.5" className="input" value={el.size ?? 10} onChange={(e) => onChange({ size: Number(e.target.value) || 10 })} data-testid="el-size" />
          </label>
          <label className="block">
            <span className="label">Colour</span>
            <input type="color" className="input h-[38px] p-1" value={el.color || "#111111"} onChange={(e) => onChange({ color: e.target.value })} />
          </label>
        </div>
      )}
      {(el.type === "text" || el.type === "pagenum" || el.type === "box") && (
        <div className="flex flex-wrap gap-1.5">
          {([["bold", "Bold"], ["italic", "Italic"], ["mono", "Typewriter"], ["upper", "CAPITALS"]] as const).map(([k, l]) => (
            <button key={k} type="button" className={`btn btn-sm ${el[k] ? "btn-primary" : ""}`} aria-pressed={!!el[k]} onClick={() => onChange({ [k]: !el[k] })}>{l}</button>
          ))}
          {(["left", "center", "right"] as const).map((a) => (
            <button key={a} type="button" className={`btn btn-sm ${(el.align || "left") === a ? "btn-primary" : ""}`} aria-pressed={(el.align || "left") === a} onClick={() => onChange({ align: a })}>{a === "left" ? "Left" : a === "center" ? "Centre" : "Right"}</button>
          ))}
        </div>
      )}
      {(el.type === "line" || el.type === "box") && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="label">Line thickness</span>
            <input type="number" min="0" max="10" step="0.5" className="input" value={el.stroke ?? 1} onChange={(e) => onChange({ stroke: Number(e.target.value) })} />
          </label>
          {el.type === "box" && (
            <label className="block">
              <span className="label">Fill</span>
              <input type="color" className="input h-[38px] p-1" value={el.fill || "#ffffff"} onChange={(e) => onChange({ fill: e.target.value })} />
            </label>
          )}
        </div>
      )}
      {el.type === "table" && <Columns el={el} onChange={onChange} />}
      <div className="grid grid-cols-4 gap-2">{num("x", "Left")}{num("y", el.flow === "after" ? "Below" : "Top")}{num("w", "Width")}{num("h", "Height")}</div>
      {el.type !== "table" && (
        <>
          <label className="block">
            <span className="label">Show only when it has a value</span>
            <select className="input" value={el.when || ""} onChange={(e) => onChange({ when: e.target.value || undefined })}>
              <option value="">Always</option>
              {doc === "pull" && <option value="so.mustCheck">The order is marked MUST CHECK</option>}
              {FIELDS[doc].map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </label>
          {doc !== "label" && doc !== "boxlabel" && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="label">Place</span>
                <select className="input" value={el.flow || "page"} onChange={(e) => onChange({ flow: e.target.value as El["flow"] })}>
                  <option value="page">On the page</option>
                  <option value="after">Below the lines</option>
                </select>
              </label>
              <label className="block">
                <span className="label">Pages</span>
                <select className="input" value={el.pages || (el.type === "pagenum" ? "all" : "first")} onChange={(e) => onChange({ pages: e.target.value as El["pages"] })}>
                  <option value="first">First page</option>
                  <option value="all">Every page</option>
                  <option value="rest">After the first</option>
                </select>
              </label>
            </div>
          )}
        </>
      )}
      <div className="flex gap-2">
        <button type="button" className="btn grow" onClick={() => onChange({ hidden: !el.hidden })}>{el.hidden ? "Show it" : "Hide it"}</button>
        {el.type !== "table" && <button type="button" className="btn btn-danger" onClick={onRemove}>Remove</button>}
      </div>
    </div>
  );
}

function Columns({ el, onChange }: { el: El; onChange: (p: Partial<El>) => void }) {
  const cols = el.columns || [];
  const set = (i: number, p: Partial<Column>) => onChange({ columns: cols.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= cols.length) return;
    const next = [...cols];
    [next[i], next[j]] = [next[j], next[i]];
    onChange({ columns: next });
  };
  return (
    <div className="space-y-2" data-testid="columns">
      <label className="block">
        <span className="label">Text size in the list</span>
        <input type="number" min="5" max="16" step="0.5" className="input" value={el.rowSize ?? 9.5} onChange={(e) => onChange({ rowSize: Number(e.target.value) || 9.5 })} />
      </label>
      <span className="label">Columns</span>
      {cols.map((c, i) => (
        <div key={c.key} className="pdfd-col">
          <input type="checkbox" checked={!c.hidden} onChange={() => set(i, { hidden: !c.hidden })} aria-label={`Show ${c.label || c.key}`} />
          <input className="input grow" value={c.label} onChange={(e) => set(i, { label: e.target.value })} aria-label="Heading" />
          <input type="number" min="0.02" max="1" step="0.01" className="input w-16" value={c.w} onChange={(e) => set(i, { w: Math.max(0.02, Number(e.target.value) || 0.1) })} aria-label="Width share" />
          <button type="button" className="btn btn-sm" onClick={() => move(i, -1)} aria-label="Move left">↑</button>
          <button type="button" className="btn btn-sm" onClick={() => move(i, 1)} aria-label="Move right">↓</button>
        </div>
      ))}
    </div>
  );
}
