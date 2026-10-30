"use client";

import { useEffect, useRef, useState } from "react";

type Build = () => Promise<Uint8Array>;

const isTouchApple = () => typeof navigator !== "undefined" && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

/**
 * Shows a PDF made in the browser: every page drawn to fit the width (phone or computer), with
 * Download, Share, Print and Open buttons. `build` makes the PDF; `buildKey` changes when it should be made again.
 */
export function PdfViewer({
  build,
  buildKey,
  filename,
  workerSrc = "/pdf.worker.v6.min.js",
  children,
  compact,
}: {
  build: Build;
  buildKey: string;
  filename: string;
  workerSrc?: string;
  /** extra controls on the toolbar (e.g. label size) */
  children?: React.ReactNode;
  compact?: boolean;
}) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pages, setPages] = useState(0);
  const [text, setText] = useState("");
  const holder = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const urlRef = useRef<string | null>(null);
  const buildRef = useRef(build);
  buildRef.current = build;

  // make the PDF
  useEffect(() => {
    let off = false;
    setBusy(true);
    setError(null);
    buildRef
      .current()
      .then((b) => !off && setBytes(b))
      .catch((e) => !off && setError(String(e?.message || e)))
      .finally(() => !off && setBusy(false));
    return () => {
      off = true;
    };
  }, [buildKey]);

  useEffect(() => {
    if (!bytes) return;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  }, [bytes]);
  useEffect(() => () => void (urlRef.current && URL.revokeObjectURL(urlRef.current)), []);

  // follow the space available
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // draw the pages
  useEffect(() => {
    if (!bytes || !width || !holder.current) return;
    let off = false;
    const box = holder.current;
    (async () => {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
      const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      if (off) return;
      setPages(doc.numPages);
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const frag = document.createDocumentFragment();
      const texts: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const fit = Math.min(width - 2, base.width * 2.2) / base.width;
        const vp = page.getViewport({ scale: fit * zoom * dpr });
        const c = document.createElement("canvas");
        c.width = Math.floor(vp.width);
        c.height = Math.floor(vp.height);
        c.style.width = `${Math.floor(vp.width / dpr)}px`;
        c.style.height = `${Math.floor(vp.height / dpr)}px`;
        c.className = "pdfv-page";
        c.setAttribute("aria-label", `Page ${i} of ${doc.numPages}`);
        c.setAttribute("role", "img");
        await page.render({ canvasContext: c.getContext("2d")!, viewport: vp, canvas: c } as any).promise;
        // the words on the page, for screen readers (the pages themselves are pictures)
        try {
          const tc = await page.getTextContent();
          texts.push(tc.items.map((it: any) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : "")).join("").replace(/[ \t]+/g, " "));
        } catch {}
        if (off) return;
        frag.appendChild(c);
      }
      if (off) return;
      box.replaceChildren(frag);
      setText(texts.map((t, i) => `Page ${i + 1}:\n${t}`).join("\n\n"));
      void doc.cleanup?.();
    })().catch((e) => !off && setError(String(e?.message || e)));
    return () => {
      off = true;
    };
  }, [bytes, width, zoom, workerSrc]);

  const file = () => new File([bytes as BlobPart], filename, { type: "application/pdf" });
  const download = () => {
    if (!urlRef.current) return;
    const a = Object.assign(document.createElement("a"), { href: urlRef.current, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const canShare = typeof navigator !== "undefined" && !!navigator.canShare && !!bytes && (() => { try { return navigator.canShare({ files: [file()] }); } catch { return false; } })();
  const share = async () => {
    try {
      await navigator.share({ files: [file()], title: filename });
    } catch {}
  };
  const open = () => urlRef.current && window.open(urlRef.current, "_blank", "noopener");
  const print = () => {
    if (!urlRef.current) return;
    // phones print from the PDF itself (share sheet or the browser's PDF view)
    if (isTouchApple() || document.documentElement.classList.contains("mobile")) return void (canShare ? share() : open());
    const f = document.createElement("iframe");
    Object.assign(f.style, { position: "fixed", right: "0", bottom: "0", width: "1px", height: "1px", border: "0", opacity: "0" });
    f.src = urlRef.current;
    f.onload = () => {
      try {
        f.contentWindow!.focus();
        f.contentWindow!.print();
      } catch {
        open();
      }
      setTimeout(() => f.remove(), 60_000);
    };
    document.body.appendChild(f);
  };

  return (
    <div className="pdfv" data-testid="pdf-viewer">
      <div className={`pdfv-bar print:hidden ${compact ? "pdfv-compact" : ""}`}>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary" onClick={print} disabled={!bytes} data-testid="pdf-print">
            Print
          </button>
          <button type="button" className="btn" onClick={download} disabled={!bytes} data-testid="pdf-download">
            Download
          </button>
          {canShare && (
            <button type="button" className="btn" onClick={share} data-testid="pdf-share">
              Share
            </button>
          )}
          <button type="button" className="btn" onClick={open} disabled={!bytes}>
            Open
          </button>
          <span className="ml-auto flex items-center gap-1 text-sm text-stone-500">
            <button type="button" className="btn btn-sm" onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 4) / 4))} aria-label="Zoom out">
              −
            </button>
            <span className="w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
            <button type="button" className="btn btn-sm" onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.25) * 4) / 4))} aria-label="Zoom in">
              +
            </button>
          </span>
        </div>
        {children}
        <div className="text-xs text-stone-500" aria-live="polite" data-testid="pdf-status">
          {error ? <span className="text-red-700">The PDF couldn&apos;t be made: {error}</span> : busy ? "Making the PDF…" : `${filename} · ${pages} page${pages === 1 ? "" : "s"}`}
        </div>
      </div>
      <div className="pdfv-scroll">
        <div ref={holder} className="pdfv-pages" data-testid="pdf-pages" aria-hidden="true" />
        <div className="sr-only" data-testid="pdf-text" style={{ whiteSpace: "pre-wrap" }}>{text}</div>
      </div>
    </div>
  );
}

/** The viewer over the page, for things printed from a screen (route sheet, designer preview). */
export function PdfModal({ open, onClose, title, ...rest }: { open: boolean; onClose: () => void; title: string } & React.ComponentProps<typeof PdfViewer>) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", k);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="pdfv-modal" role="dialog" aria-modal="true" aria-label={title} data-testid="pdf-modal">
      <div className="pdfv-modal-bar">
        <b className="truncate">{title}</b>
        <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="pdfv-modal-body">
        <PdfViewer {...rest} />
      </div>
    </div>
  );
}
