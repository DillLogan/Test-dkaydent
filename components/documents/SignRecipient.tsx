// @ts-nocheck — ported from the BrightStar CRM handoff (recipient signing page)
"use client";
import { useEffect, useRef, useState } from "react";

const initialsOf = (name) => (name || "").trim().split(/\s+/).map((w) => w[0] || "").join("").toUpperCase().slice(0, 6);
const isImg = (v) => typeof v === "string" && v.startsWith("data:image");

/* Draw pad — finger/mouse signature, returns a trimmed PNG data URL. */
function DrawPad({ title, onUse, onClose }) {
  const ref = useRef(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    const c = ref.current; const ctx = c.getContext("2d");
    ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.strokeStyle = "#12203a";
  }, []);
  const pos = (e) => { const r = ref.current.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e) => { e.preventDefault(); drawing.current = true; const p = pos(e); const ctx = ref.current.getContext("2d"); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  const move = (e) => { if (!drawing.current) return; const p = pos(e); const ctx = ref.current.getContext("2d"); ctx.lineTo(p.x, p.y); ctx.stroke(); dirty.current = true; };
  const up = () => { drawing.current = false; };
  const clear = () => { const c = ref.current; c.getContext("2d").clearRect(0, 0, c.width, c.height); dirty.current = false; };
  const use = () => { if (!dirty.current) { onClose(); return; } onUse(ref.current.toDataURL("image/png")); };
  return (
    <div className="overlay" style={{ zIndex: 60 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 440, width: "100%" }}>
        <div className="modal-head"><h2 style={{ fontSize: 16 }}>{title}</h2><button className="icon-btn" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          <canvas ref={ref} width={380} height={160} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
            style={{ width: "100%", height: 160, border: "1px dashed var(--line)", borderRadius: 8, background: "#fff", touchAction: "none", cursor: "crosshair" }} />
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Draw with your finger or mouse.</div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost sm" onClick={clear}>Clear</button>
          <button className="btn primary sm" onClick={use}>Use this</button>
        </div>
      </div>
    </div>
  );
}

export default function SignRecipient({ token }) {
  const [pages, setPages] = useState([]);
  const [boxes, setBoxes] = useState([]);
  const [docName, setDocName] = useState("");
  const [values, setValues] = useState({});
  const [fullName, setFullName] = useState("");
  const [initials, setInitials] = useState("");
  const [initTouched, setInitTouched] = useState(false);
  const [drawnSig, setDrawnSig] = useState("");
  const [drawnInit, setDrawnInit] = useState("");
  const [drawMode, setDrawMode] = useState(null); // "sig" | "init" | null
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [already, setAlready] = useState(false);
  const [busy, setBusy] = useState(false);
  // identity gate
  const [verified, setVerified] = useState("");   // the email that matched
  const [gateName, setGateName] = useState("");
  const [gateEmail, setGateEmail] = useState("");
  const [gateErr, setGateErr] = useState("");
  const [gateBusy, setGateBusy] = useState(false);
  const [dlBusy, setDlBusy] = useState(false);

  const [sender, setSender] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [viaAccount, setViaAccount] = useState(false);

  // Load the pages for a checked signer. `email` is sent only for someone confirming by email.
  async function loadPages(email, boxesFromServer) {
    setLoading(true);
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.v6.min.js";
    const fr = await fetch(`/api/sign/${token}/file`, { cache: "no-store", headers: email ? { "x-signer-email": email } : {} });
    if (!fr.ok) { const ej = await fr.json().catch(() => ({})); throw new Error(ej.error || `Couldn't load the document (${fr.status}).`); }
    const bytes = await fr.arrayBuffer();
    const head = new TextDecoder().decode(new Uint8Array(bytes.slice(0, 5)));
    if (!head.startsWith("%PDF")) throw new Error("The document file couldn't be read.");
    const loadingTask = pdfjs.getDocument({ data: bytes });
    const pdf = await loadingTask.promise;
    const rendered = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const targetW = Math.min(800, Math.max(560, (typeof window !== "undefined" ? window.innerWidth : 800) * 1.5));
      const vp = page.getViewport({ scale: targetW / page.getViewport({ scale: 1 }).width });
      const canvas = document.createElement("canvas");
      canvas.width = vp.width; canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext("2d"), canvas, viewport: vp }).promise;
      rendered.push({ num: n, dataUrl: canvas.toDataURL("image/jpeg", 0.85) });
    }
    try { await loadingTask.destroy(); } catch {}
    setPages(rendered); setBoxes(boxesFromServer || []); setLoading(false);
  }

  // Step 1: what this link needs. A DKaydent login signs while signed in; anyone else confirms the email.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/sign/${token}`, { cache: "no-store" });
        const j = await r.json();
        if (j.error) throw new Error(j.error);
        if (cancelled) return;
        setDocName(j.docName || "Document"); setSender(j.sender || "");
        if (j.needsLogin) { setNeedsLogin(true); setLoading(false); return; }
        if (j.needsEmail) { setLoading(false); return; }
        // signed in as the right account
        setViaAccount(true); setVerified("account");
        if (j.status === "completed") { setAlready(true); setLoading(false); return; }
        await loadPages(null, j.boxes);
      } catch (e) { if (!cancelled) { setErr(e.message || "Failed to load."); setLoading(false); } }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // Step 2 (email route): check the email with the server, then load the document.
  async function verify() {
    const email = gateEmail.trim();
    if (!gateName.trim() || !email) { setGateErr("Enter your full name and email."); return; }
    setGateBusy(true); setGateErr("");
    try {
      const r = await fetch(`/api/sign/${token}`, { cache: "no-store", headers: { "x-signer-email": email } });
      const j = await r.json();
      if (!r.ok || j.error) { setGateErr(j.error || "Couldn't verify."); setGateBusy(false); return; }
      setVerified(email);
      if (!fullName) setFullName(gateName.trim());
      if (j.status === "completed") { setAlready(true); setGateBusy(false); return; }
      await loadPages(email, j.boxes);
    } catch (e) { setErr(e.message || "Failed to load."); setLoading(false); }
    setGateBusy(false);
  }

  async function download() {
    setDlBusy(true);
    try {
      const r = await fetch(`/api/sign/${token}/signed`, { cache: "no-store", headers: viaAccount ? {} : { "x-signer-email": verified } });
      if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.error || "Download failed."); setDlBusy(false); return; }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${(docName || "document").replace(/[^A-Za-z0-9 _.-]/g, "").trim() || "document"} - signed.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch { alert("Download failed."); }
    setDlBusy(false);
  }

  const effInitials = initTouched ? initials : initialsOf(fullName);
  const setVal = (id, v) => setValues((x) => ({ ...x, [id]: v }));

  function clickBox(b) {
    if (b.type === "signature") {
      const v = drawnSig || fullName.trim();
      if (!v) { setErr("Set your signature up top (type your name or draw it), then tap the box."); return; }
      setErr(""); setVal(b.id, v);
    } else if (b.type === "initials") {
      const v = drawnInit || effInitials;
      if (!v) { setErr("Add your initials up top first."); return; }
      setErr(""); setVal(b.id, v);
    } else if (b.type === "checkbox") {
      setVal(b.id, values[b.id] ? "" : "X");
    }
  }

  async function submit() {
    setBusy(true); setErr("");
    try {
      const r = await fetch(`/api/sign/${token}/complete`, {
        method: "POST",
        headers: viaAccount ? { "Content-Type": "application/json" } : { "Content-Type": "application/json", "x-signer-email": verified },
        body: JSON.stringify({ values, name: (viaAccount ? fullName : gateName).trim() }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Couldn't submit."); setBusy(false); return; }
      setDone(true);
    } catch { setErr("Couldn't submit — try again."); }
    setBusy(false);
  }

  const dlButton = (
    <button onClick={download} disabled={dlBusy} style={{ ...btn("#369F64"), marginTop: 16, padding: "11px 20px", fontSize: 14 }}>
      {dlBusy ? "Preparing…" : "Download signed PDF"}
    </button>
  );

  if (loading) return <Center>Loading document…</Center>;
  if (needsLogin) {
    return (
      <Center>
        <div style={{ background: "#fff", color: "#1c1917", borderRadius: 16, padding: 22, width: "100%", maxWidth: 380, textAlign: "left" }} data-testid="sign-needs-login">
          <div style={{ fontWeight: 700, fontSize: 17 }}>{docName || "Document"}</div>
          {sender && <div style={{ fontSize: 13, color: "#57534e", marginTop: 4 }}>Sent by {sender}</div>}
          <div style={{ fontSize: 14, color: "#44403c", marginTop: 10 }}>This document was sent to your DKaydent account. Sign in with that account to open and sign it.</div>
          <a href={`/login?next=${encodeURIComponent(`/sign/${token}`)}`} style={{ ...btn("#255e38"), display: "block", textAlign: "center", textDecoration: "none", marginTop: 14, padding: "11px 12px", fontSize: 14 }}>Sign in to open</a>
        </div>
      </Center>
    );
  }
  if (err && !verified) return <Center><div style={{ maxWidth: 380 }}>{err}</div></Center>;
  if (!verified) {
    const inp = { width: "100%", border: "1px solid #ccc", borderRadius: 8, padding: "10px 12px", fontSize: 14, boxSizing: "border-box", marginTop: 10 };
    return (
      <Center>
        <div style={{ background: "#fff", color: "#1d1d1f", borderRadius: 14, padding: 22, width: "100%", maxWidth: 380, textAlign: "left" }}>
          <div style={{ fontWeight: 800, fontSize: 17 }}>{docName || "Document"}</div>
          {sender && <div style={{ fontSize: 13, color: "#57534e", marginTop: 4 }}>Sent by {sender}</div>}
          <div style={{ fontSize: 13, color: "#6e6e73", marginTop: 4 }}>To open this document, enter your name and the email address it was sent to.</div>
          {err && <div style={{ color: "#B34040", fontSize: 13, marginTop: 10 }}>{err}</div>}
          <input value={gateName} onChange={(e) => setGateName(e.target.value)} placeholder="Full name" autoComplete="name" style={inp} />
          <input value={gateEmail} onChange={(e) => setGateEmail(e.target.value)} placeholder="Email address" type="email" autoComplete="email"
            onKeyDown={(e) => e.key === "Enter" && verify()} style={inp} />
          {gateErr && <div style={{ color: "#B34040", fontSize: 13, marginTop: 10 }}>{gateErr}</div>}
          <button onClick={verify} disabled={gateBusy} style={{ ...btn("#255e38"), width: "100%", marginTop: 14, padding: "11px 12px", fontSize: 14 }}>
            {gateBusy ? "Checking…" : "Open document"}
          </button>
        </div>
      </Center>
    );
  }
  if (already) return <Center><div><b>This document has already been completed.</b><br />Thank you.<br />{dlButton}</div></Center>;
  if (done) return <Center><div><b>All done — thank you!</b><br />Your completed document has been sent back.<br />{dlButton}</div></Center>;

  return (
    <div style={{ minHeight: "100vh", background: "#1c1917", padding: "12px 0 60px" }}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "0 12px" }}>
        <div style={{ background: "#fff", borderRadius: 12, padding: 14, position: "sticky", top: 8, zIndex: 5, boxShadow: "0 4px 16px rgba(0,0,0,.3)", marginBottom: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: "#1d1d1f" }}>{docName}</div>
          <div style={{ fontSize: 12.5, color: "#6e6e73", margin: "2px 0 10px" }}>Type or draw your signature/initials, then tap each Signature/Initials box to fill it. Fill text fields, tick checkboxes, then Submit.</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name (for signature)"
              style={{ flex: 1, minWidth: 150, border: "1px solid #ccc", borderRadius: 8, padding: "9px 11px" }} />
            <button onClick={() => setDrawMode("sig")} style={btn(drawnSig ? "#369F64" : "#255e38")}>{drawnSig ? "✓ Signature drawn" : "Draw signature"}</button>
            <input value={effInitials} onChange={(e) => { setInitTouched(true); setInitials(e.target.value.toUpperCase().slice(0, 6)); }} placeholder="Initials"
              style={{ width: 90, border: "1px solid #ccc", borderRadius: 8, padding: "9px 11px" }} />
            <button onClick={() => setDrawMode("init")} style={btn(drawnInit ? "#369F64" : "#7B5EA7")}>{drawnInit ? "✓ Initials drawn" : "Draw initials"}</button>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
              <button onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} style={btn("#555", true)}>−</button>
              <span style={{ fontSize: 12, color: "#333", minWidth: 40, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} style={btn("#555", true)}>+</button>
            </span>
            <div style={{ flex: 1 }} />
            <button onClick={submit} disabled={busy} style={{ ...btn("#255e38"), padding: "10px 20px", fontSize: 14 }}>{busy ? "Submitting…" : "Submit"}</button>
          </div>
          {err && <div style={{ color: "#B34040", fontSize: 13, marginTop: 8 }}>{err}</div>}
        </div>

        <div style={{ overflowX: "auto" }}>
          {pages.map((p) => (
            <div key={p.num} style={{ position: "relative", width: `${zoom * 100}%`, maxWidth: zoom <= 1 ? "100%" : "none", margin: "0 auto 16px", boxShadow: "0 2px 12px rgba(0,0,0,.35)", background: "#fff" }}>
              <img src={p.dataUrl} alt={`Page ${p.num}`} draggable={false} style={{ width: "100%", display: "block" }} />
              {boxes.filter((b) => b.page === p.num).map((b) => {
                const v = values[b.id];
                const common = { containerType: "size", position: "absolute", left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`, boxSizing: "border-box" };
                const filledBg = b.fill ? "#fff" : (b.underline ? "transparent" : "rgba(37,94,56,.06)");
                const bord = b.underline ? { borderBottom: "2px solid #255e38" } : { border: `2px ${b.fill ? "solid" : "dashed"} #255e38`, borderRadius: 4 };
                if (b.type === "text") {
                  return <input key={b.id} value={v || ""} onChange={(e) => setVal(b.id, e.target.value)} placeholder={b.label || ""}
                    style={{ ...common, ...bord, background: filledBg, padding: "0 4px", fontSize: 13, color: "#111", outline: "none" }} />;
                }
                if (b.type === "checkbox") {
                  return <div key={b.id} onClick={() => clickBox(b)} title={b.label || "Tap to check"}
                    style={{ ...common, ...bord, background: filledBg, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {v ? <span style={{ color: "#255e38", fontWeight: 900, fontSize: "min(22px, 80cqh)", lineHeight: 1 }}>✓</span> : null}
                  </div>;
                }
                return (
                  <div key={b.id} onClick={() => clickBox(b)} title={b.label || (b.type === "initials" ? "Tap to add initials" : "Tap to sign")}
                    style={{ ...common, ...bord, background: v ? (b.fill ? "#fff" : "transparent") : filledBg, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px", overflow: "hidden" }}>
                    {isImg(v)
                      ? <img src={v} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                      : v
                        ? <span style={{ fontFamily: "'Segoe Script','Brush Script MT',cursive", fontStyle: "italic", fontSize: `min(${b.type === "initials" ? 20 : 18}px, 70cqh)`, color: "#12203a", whiteSpace: "nowrap" }}>{v}</span>
                        : <span style={{ fontSize: 11, color: "#255e38", opacity: .8 }}>{b.type === "initials" ? "Initials" : "Sign here"}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {drawMode && <DrawPad title={drawMode === "sig" ? "Draw your signature" : "Draw your initials"}
        onClose={() => setDrawMode(null)}
        onUse={(d) => { if (drawMode === "sig") setDrawnSig(d); else setDrawnInit(d); setDrawMode(null); }} />}
    </div>
  );
}

function btn(bg, small) {
  return { background: bg, color: "#fff", border: "none", borderRadius: 8, padding: small ? "7px 11px" : "9px 12px", fontWeight: 700, cursor: "pointer", fontSize: 13 };
}
function Center({ children }) {
  return <div style={{ minHeight: "100vh", background: "#1c1917", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24, fontSize: 15, lineHeight: 1.6 }}><div>{children}</div></div>;
}
