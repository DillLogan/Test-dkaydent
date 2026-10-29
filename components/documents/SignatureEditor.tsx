// @ts-nocheck — ported from the BrightStar CRM handoff (PDF signature field editor)
"use client";
import { useEffect, useRef, useState } from "react";

const CUE = /signature|sign here|sign:|initial|print(ed)?\s*name|date|title/i;
const guessType = (s) => (/signature|sign\b/i.test(s || "") ? "signature" : "text");
const newId = () => "box_" + Math.random().toString(36).slice(2, 9);

function rectToBox(page, x1, y1, x2, y2, pw, ph, type, label) {
  const x = Math.min(x1, x2) / pw, w = Math.abs(x2 - x1) / pw;
  const yTop = ph - Math.max(y1, y2);
  return {
    id: newId(), page, type, label: (label || "").trim().slice(0, 40),
    x: Math.max(0, Math.min(x, 0.95)), y: Math.max(0, Math.min(yTop / ph, 0.95)),
    w: Math.min(Math.max(w, 0.08), 0.9), h: Math.min(Math.max(Math.abs(y2 - y1) / ph, 0.025), 0.2),
  };
}

export default function SignatureEditor({ docId, docName, onClose }) {
  const [pages, setPages] = useState([]);     // [{num, w, h, dataUrl}]
  const [boxes, setBoxes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState("");
  const [placing, setPlacing] = useState(null); // "signature" | "text" | null
  const [sel, setSel] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [zoom, setZoom] = useState(1);
  const drag = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const dj = await (await fetch(`/api/signatures/${docId}`)).json();
        const existing = dj.doc?.boxes || [];
        const fr = await fetch(`/api/signatures/${docId}/file`, { cache: "no-store" });
        if (!fr.ok) throw new Error("Couldn't load the document file.");
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.v6.min.js";
        const bytes = await fr.arrayBuffer(); // bytes come through our own route, so no storage link reaches the browser
        const loadingTask = pdfjs.getDocument({ data: bytes }); // v6: eval-based font code (CVE-2024-4367) removed upstream
        const pdf = await loadingTask.promise;
        const rendered = [], suggestions = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const targetW = Math.min(820, Math.max(560, (typeof window !== "undefined" ? window.innerWidth : 820) * 1.5));
          const scale = targetW / base.width;
          const vp = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = vp.width; canvas.height = vp.height;
          await page.render({ canvasContext: canvas.getContext("2d"), canvas, viewport: vp }).promise;
          rendered.push({ num: n, w: vp.width, h: vp.height, dataUrl: canvas.toDataURL("image/jpeg", 0.85) });
          if (!existing.length) {
            try {
              const ann = await page.getAnnotations();
              const widgets = ann.filter((a) => a.subtype === "Widget" && a.rect);
              if (widgets.length) {
                for (const a of widgets) {
                  const [x1, y1, x2, y2] = a.rect;
                  suggestions.push(rectToBox(n, x1, y1, x2, y2, base.width, base.height, guessType(a.fieldName), a.fieldName || ""));
                }
              } else {
                const tc = await page.getTextContent();
                for (const it of tc.items) {
                  if (it.str && CUE.test(it.str)) {
                    const tx = it.transform[4], ty = it.transform[5], w = it.width || 100, h = it.height || 12;
                    suggestions.push(rectToBox(n, tx + w + 6, ty - 2, tx + w + 156, ty + h + 6, base.width, base.height, guessType(it.str), it.str.trim().slice(0, 40)));
                  }
                }
              }
            } catch {}
          }
        }
        try { await loadingTask.destroy(); } catch {}  // free the pdf.js worker so the doc can be reopened
        if (cancelled) return;
        setPages(rendered);
        setBoxes(existing.length ? existing : suggestions);
        setDirty(!existing.length && suggestions.length > 0);
        setLoading(false);
      } catch (e) { if (!cancelled) { setErr(e.message || "Failed to load document."); setLoading(false); } }
    })();
    return () => { cancelled = true; };
  }, [docId]);

  const update = (id, patch) => { setBoxes((b) => b.map((x) => (x.id === id ? { ...x, ...patch } : x))); setDirty(true); };
  const remove = (id) => { setBoxes((b) => b.filter((x) => x.id !== id)); setSel(null); setDirty(true); };

  function onPageClick(e, page) {
    if (!placing) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    const sizes = { signature: [0.2, 0.06], initials: [0.1, 0.05], checkbox: [0.035, 0.028], text: [0.2, 0.035] };
    const [w, h] = sizes[placing] || [0.18, 0.04];
    const box = { id: newId(), page, type: placing, label: "", x: Math.min(x, 1 - w), y: Math.min(y, 1 - h), w, h };
    setBoxes((b) => [...b, box]); setSel(box.id); setPlacing(null); setDirty(true);
  }

  function startDrag(e, box, mode) {
    e.stopPropagation(); e.preventDefault();
    const pageEl = e.currentTarget.closest(".sig-page");
    drag.current = { id: box.id, mode, pageEl, startX: e.clientX, startY: e.clientY, ox: box.x, oy: box.y, ow: box.w, oh: box.h };
    setSel(box.id);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", endDrag);
  }
  function onMove(e) {
    const d = drag.current; if (!d) return;
    const r = d.pageEl.getBoundingClientRect();
    const dx = (e.clientX - d.startX) / r.width, dy = (e.clientY - d.startY) / r.height;
    if (d.mode === "move") update(d.id, { x: Math.max(0, Math.min(d.ox + dx, 1 - d.ow)), y: Math.max(0, Math.min(d.oy + dy, 1 - d.oh)) });
    else update(d.id, { w: Math.max(0.05, Math.min(d.ow + dx, 1 - d.ox)), h: Math.max(0.02, Math.min(d.oh + dy, 1 - d.oy)) });
  }
  function endDrag() { drag.current = null; window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", endDrag); }

  async function save() {
    setStatus("Saving…");
    try {
      const r = await fetch(`/api/signatures/${docId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boxes, pageCount: pages.length, status: "ready" }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setStatus(j.error || "Save failed."); return; }
      setDirty(false); setStatus("Saved.");
      setTimeout(() => setStatus(""), 2500);
    } catch { setStatus("Save failed."); }
  }

  return (
    <div className="modal-bg fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 sm:p-4">
      <div className="flex h-full w-full max-w-5xl flex-col overflow-hidden bg-white shadow-xl sm:h-[94vh] sm:rounded-2xl" data-testid="sig-editor">
        <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-4 py-3">
          <h2 className="min-w-0 flex-1 basis-full truncate text-base font-semibold text-stone-900 sm:basis-auto">{docName || "Prepare document"}</h2>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <button className={"btn btn-sm" + (placing === "signature" ? " btn-primary" : "")} onClick={() => setPlacing(placing === "signature" ? null : "signature")}>+ Signature</button>
            <button className={"btn btn-sm" + (placing === "initials" ? " btn-primary" : "")} onClick={() => setPlacing(placing === "initials" ? null : "initials")}>+ Initials</button>
            <button className={"btn btn-sm" + (placing === "checkbox" ? " btn-primary" : "")} onClick={() => setPlacing(placing === "checkbox" ? null : "checkbox")}>+ Checkbox</button>
            <button className={"btn btn-sm" + (placing === "text" ? " btn-primary" : "")} onClick={() => setPlacing(placing === "text" ? null : "text")}>+ Text</button>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 2, marginLeft: 4 }}>
              <button className="btn btn-sm" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} title="Zoom out">−</button>
              <span className="min-w-[38px] text-center text-xs text-stone-500">{Math.round(zoom * 100)}%</span>
              <button className="btn btn-sm" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} title="Zoom in">+</button>
            </span>
            <button className="btn btn-sm btn-primary" disabled={!dirty} onClick={save}>Save</button>
            <button className="btn btn-sm" onClick={onClose} title="Close" aria-label="Close">✕</button>
          </div>
        </div>

        {placing && <div className="px-4 py-1.5 text-sm text-brand-700">Tap the page where the {placing} box should go.</div>}
        {status && <div className="px-4 py-1 text-sm text-stone-600">{status}</div>}

        <div className="flex-1 overflow-auto bg-stone-100 p-3 sm:p-6" onClick={() => setSel(null)}>
          {loading && <div className="p-8 text-center text-stone-500">Loading document…</div>}
          {err && <div role="alert" className="m-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>}
          {pages.map((p) => (
            <div key={p.num} className="sig-page" onClick={(e) => onPageClick(e, p.num)}
              style={{ position: "relative", width: `${zoom * 100}%`, maxWidth: zoom <= 1 ? p.w : "none", margin: "0 auto 18px", boxShadow: "0 2px 10px rgba(0,0,0,.15)", cursor: placing ? "crosshair" : "default", touchAction: "manipulation" }}>
              <img src={p.dataUrl} alt={`Page ${p.num}`} draggable={false} style={{ width: "100%", display: "block" }} />
              {boxes.filter((b) => b.page === p.num).map((b) => {
                const accent = b.type === "signature" ? "#294A7F" : b.type === "initials" ? "#7B5EA7" : b.type === "checkbox" ? "#C28A1F" : "#369F64";
                return (
                <div key={b.id} onClick={(e) => { e.stopPropagation(); setSel(b.id); }}
                  onPointerDown={(e) => startDrag(e, b, "move")}
                  style={{
                    position: "absolute", left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`,
                    border: b.underline ? "none" : `2px ${b.fill ? "solid" : "dashed"} ${accent}`,
                    borderBottom: b.underline ? `2px solid ${accent}` : undefined,
                    background: b.fill ? "#fff" : (b.underline ? "transparent" : `${accent}22`),
                    borderRadius: b.underline ? 0 : 4, cursor: "move", boxSizing: "border-box",
                    outline: sel === b.id ? "2px solid var(--color-brand-600)" : "none", touchAction: "none",
                  }}>
                  <span style={{ position: "absolute", top: -18, left: 0, fontSize: 10, fontWeight: 700, color: accent, whiteSpace: "nowrap" }}>
                    {b.label || (b.type === "signature" ? "Signature" : b.type === "initials" ? "Initials" : b.type === "checkbox" ? "Checkbox" : "Text")}
                  </span>
                  <div onPointerDown={(e) => startDrag(e, b, "resize")}
                    style={{ position: "absolute", right: -10, bottom: -10, width: 20, height: 20, background: "#fff", border: "2px solid var(--color-brand-600)", borderRadius: 5, cursor: "nwse-resize", touchAction: "none" }} />
                </div>
                );
              })}
            </div>
          ))}
        </div>

        {sel && (() => {
          const b = boxes.find((x) => x.id === sel); if (!b) return null;
          return (
            <div className="flex flex-wrap items-center gap-2.5 border-t border-stone-200 px-4 py-3">
              <select value={b.type} onChange={(e) => update(b.id, { type: e.target.value })}
                className="input w-auto">
                <option value="signature">Signature (scribble/stamp)</option>
                <option value="initials">Initials (stamp)</option>
                <option value="checkbox">Checkbox</option>
                <option value="text">Text field (typed)</option>
              </select>
              <input value={b.label} placeholder="Label — what goes here (optional)" onChange={(e) => update(b.id, { label: e.target.value })}
                className="input min-w-40 flex-1" />
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={!!b.fill} onChange={(e) => update(b.id, { fill: e.target.checked })} /> Fill (white)
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={!!b.underline} onChange={(e) => update(b.id, { underline: e.target.checked })} /> Underline
              </label>
              <button className="btn btn-sm btn-danger" onClick={() => remove(b.id)}>Delete box</button>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
