// @ts-nocheck — ported from the BrightStar CRM handoff (Wordsmith). Documents are private to their owner.
"use client";
/* ─────────────────────────────────────────────────────────────────────
   Wordsmith (build 124) — a Word-style editor with a writing diary.
   Only shown to accounts with the "wordsmith" role; documents are private
   to their owner. Built on TipTap; to add an editor feature, add its
   extension to buildExtensions() and a control to <Toolbar>.
   ───────────────────────────────────────────────────────────────────── */
import { useState, useEffect, useRef, useMemo, useCallback, useReducer } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { generateJSON } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle, Color, FontFamily, FontSize } from "@tiptap/extension-text-style";
import {
  DiaryDay, diaryColor, countWords, docText, wordsBySection, openEntry, ensureToday,
  startNewEntry, entryWords, newEntryId, stampJSON, safeId, todayLocal,
} from "./diary";
import { exportDocx, importDocxHtml } from "./docxio";

const FONTS = [
  ["", "Default"], ["Calibri, Carlito, sans-serif", "Calibri"], ["Arial, Helvetica, sans-serif", "Arial"],
  ["Georgia, serif", "Georgia"], ["'Times New Roman', Times, serif", "Times New Roman"],
  ["Garamond, 'EB Garamond', serif", "Garamond"], ["Verdana, sans-serif", "Verdana"], ["'Courier New', monospace", "Courier New"],
];
const SIZES = ["", "9pt", "10pt", "11pt", "12pt", "14pt", "16pt", "18pt", "20pt", "24pt", "28pt", "36pt", "48pt"];
const SAVE_DELAY = 1200;

function buildExtensions(getEntry) {
  return [
    StarterKit.configure({ link: { openOnClick: false, autolink: true, defaultProtocol: "https" } }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TextStyle, Color, FontFamily, FontSize,
    DiaryDay.configure({ getEntry }),
  ];
}

const fmtDate = (ymd) => {
  const [y, m, d] = String(ymd || "").split("-").map(Number);
  if (!y) return "";
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
};
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "");
const fmtWhen = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return todayLocal(d) === todayLocal() ? fmtTime(iso) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const n = (x) => Number(x || 0).toLocaleString();
const signed = (x) => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toLocaleString();

/* Plain text of a TipTap JSON doc, blocks and line breaks as newlines. */
function jsonText(node) {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak" || node.type === "horizontalRule") return "\n";
  const inner = (node.content || []).map(jsonText);
  return inner.join(node.content?.some((k) => k.type === "text" || k.type === "hardBreak") ? "" : "\n");
}

function readPref(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v === "1"; } catch { return fallback; }
}
function writePref(key, val) { try { localStorage.setItem(key, val ? "1" : "0"); } catch { /* storage off */ } }

/* ═══════════════════════ main tab ═══════════════════════ */
export default function Wordsmith() {
  const [docs, setDocs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [listOpen, setListOpen] = useState(true);
  const fileRef = useRef(null);

  const loadList = useCallback(async () => {
    const r = await fetch("/api/wordsmith");
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j.error || "Couldn't load your documents."); setLoading(false); return []; }
    setDocs(j.docs || []); setLoading(false);
    return j.docs || [];
  }, []);

  useEffect(() => {
    loadList().then((list) => { if (list.length) setActiveId(list[0].id); });
    if (typeof window !== "undefined" && window.innerWidth < 900) setListOpen(false);
  }, [loadList]);

  const createDoc = async (body) => {
    const r = await fetch("/api/wordsmith", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.doc) throw new Error(j.error || "Couldn't create the document.");
    setDocs((p) => [{ id: j.doc.id, title: j.doc.title, word_count: j.doc.word_count, updated_at: j.doc.updated_at, created_at: j.doc.created_at }, ...p]);
    setActiveId(j.doc.id);
    if (window.innerWidth < 900) setListOpen(false);
  };

  const newDoc = async () => {
    setBusy("new"); setError("");
    try { await createDoc({ title: "Untitled document", content: { type: "doc", content: [{ type: "paragraph" }] }, diary: [], word_count: 0 }); }
    catch (e) { setError(e.message); }
    setBusy("");
  };

  const importFile = async (file) => {
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) { setError("Choose a Word .docx file."); return; }
    setBusy("import"); setError("");
    try {
      const html = await importDocxHtml(file);
      const json = generateJSON(html, buildExtensions(() => null));
      const entryId = newEntryId();
      const stamped = stampJSON(json, entryId);
      // count from the converted document, the same way the editor counts
      const words = countWords(jsonText(json));
      const now = new Date();
      let diary = [{ id: entryId, kind: "imported", label: file.name, date: todayLocal(now), startedAt: now.toISOString(), closedAt: null, baseline: 0, words: 0 }];
      diary = startNewEntry(diary, words, now);
      await createDoc({ title: file.name.replace(/\.docx$/i, ""), content: stamped, diary, word_count: words });
    } catch (e) {
      setError(e.message && !/^\[/.test(e.message) ? e.message : "Couldn't read that file. Make sure it's a Word .docx document.");
    }
    setBusy("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const deleteDoc = async (d) => {
    if (!confirm(`Delete "${d.title}"? This can't be undone.`)) return;
    const r = await fetch(`/api/wordsmith/${encodeURIComponent(d.id)}`, { method: "DELETE" });
    if (!r.ok) { setError("Couldn't delete the document."); return; }
    const rest = docs.filter((x) => x.id !== d.id);
    setDocs(rest);
    if (activeId === d.id) setActiveId(rest[0]?.id || null);
  };

  const onMeta = useCallback((meta) => {
    setDocs((p) => {
      const next = p.map((d) => (d.id === meta.id ? { ...d, ...meta } : d));
      return next.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    });
  }, []);

  return (
    <div className="ws-wrap">
      <aside className={"ws-list" + (listOpen ? " open" : "")}>
        <div className="ws-list-head">
          <span className="ws-list-title">Documents</span>
          <button className="ws-icon-btn" onClick={() => setListOpen(false)} aria-label="Hide documents" title="Hide documents">«</button>
        </div>
        <div className="ws-list-actions">
          <button className="ws-btn primary" onClick={newDoc} disabled={!!busy}>{busy === "new" ? "Creating…" : "+ New document"}</button>
          <button className="ws-btn" onClick={() => fileRef.current?.click()} disabled={!!busy}>{busy === "import" ? "Importing…" : "Import .docx"}</button>
          <input ref={fileRef} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={(e) => importFile(e.target.files?.[0])} />
        </div>
        {error && <div className="ws-error" role="alert">{error}</div>}
        <div className="ws-list-items">
          {loading ? <div className="ws-dim">Loading…</div> : docs.length === 0 ? (
            <div className="ws-dim">No documents yet.</div>
          ) : docs.map((d) => (
            <div key={d.id} className={"ws-doc" + (d.id === activeId ? " active" : "")}>
              <button className="ws-doc-open" onClick={() => { setActiveId(d.id); if (window.innerWidth < 900) setListOpen(false); }}>
                <span className="ws-doc-name">{d.title || "Untitled document"}</span>
                <span className="ws-doc-meta">{n(d.word_count)} words · {fmtWhen(d.updated_at)}</span>
              </button>
              <button className="ws-icon-btn ws-doc-del" onClick={() => deleteDoc(d)} aria-label={`Delete ${d.title}`} title="Delete">✕</button>
            </div>
          ))}
        </div>
      </aside>

      <section className="ws-main">
        {activeId ? (
          <DocLoader key={activeId} id={activeId} onMeta={onMeta} listOpen={listOpen} onShowList={() => setListOpen(true)} />
        ) : (
          <div className="ws-empty">
            {!listOpen && <button className="ws-btn" onClick={() => setListOpen(true)}>Show documents</button>}
            {!loading && <>
              <p>Start a document, or bring one in from Word.</p>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                <button className="ws-btn primary" onClick={newDoc} disabled={!!busy}>+ New document</button>
                <button className="ws-btn" onClick={() => fileRef.current?.click()} disabled={!!busy}>Import .docx</button>
              </div>
            </>}
          </div>
        )}
      </section>
    </div>
  );
}

/* ═══════════════════════ load one document ═══════════════════════ */
function DocLoader({ id, onMeta, listOpen, onShowList }) {
  const [doc, setDoc] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    fetch(`/api/wordsmith/${encodeURIComponent(id)}`).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!live) return;
      if (!r.ok || !j.doc) setErr(j.error || "Couldn't open this document.");
      else setDoc(j.doc);
    });
    return () => { live = false; };
  }, [id]);
  if (err) return <div className="ws-empty"><p>{err}</p></div>;
  if (!doc) return <div className="ws-empty"><p>Opening…</p></div>;
  return <DocEditor doc={doc} onMeta={onMeta} listOpen={listOpen} onShowList={onShowList} />;
}

/* ═══════════════════════ the editor ═══════════════════════ */
function DocEditor({ doc, onMeta, listOpen, onShowList }) {
  const [, bump] = useReducer((x) => x + 1, 0);
  const [title, setTitle] = useState(doc.title || "Untitled document");
  const [saveState, setSaveState] = useState("saved"); // saved | dirty | saving | error | conflict
  const [showDiary, setShowDiary] = useState(() => readPref("ws.diary", typeof window === "undefined" || window.innerWidth >= 900));
  const [showMarks, setShowMarks] = useState(() => readPref("ws.marks", true));
  const [focusEntry, setFocusEntry] = useState(null);
  const [sections, setSections] = useState({});
  const [chars, setChars] = useState(0);
  const [exporting, setExporting] = useState(false);

  const diaryRef = useRef(Array.isArray(doc.diary) ? doc.diary : []);
  const totalRef = useRef(Number(doc.word_count) || 0);
  const baseRef = useRef(doc.updated_at);
  const titleRef = useRef(title);
  const timer = useRef(null);
  const sectionTimer = useRef(null);
  const saving = useRef(false);
  const pending = useRef(false);
  const dirty = useRef(false);
  const stopped = useRef(false);
  const editorRef = useRef(null);

  /* The open diary entry; rolls over to a new one when the date changes. */
  const getEntry = useCallback(() => {
    const next = ensureToday(diaryRef.current, totalRef.current);
    if (next !== diaryRef.current) { diaryRef.current = next; dirty.current = true; setTimeout(bump, 0); }
    return openEntry(diaryRef.current)?.id || null;
  }, []);

  const extensions = useMemo(() => buildExtensions(getEntry), [getEntry]);

  const doSave = useCallback(async () => {
    const ed = editorRef.current;
    if (!ed || stopped.current) return;
    if (saving.current) { pending.current = true; return; }
    let content;
    try { content = ed.getJSON(); } catch { return; }   // editor already torn down
    saving.current = true; dirty.current = false; setSaveState("saving");
    try {
      const r = await fetch(`/api/wordsmith/${encodeURIComponent(doc.id)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: titleRef.current, content, diary: diaryRef.current, word_count: totalRef.current, base: baseRef.current }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409) { stopped.current = true; setSaveState("conflict"); }
      else if (!r.ok) { dirty.current = true; setSaveState("error"); }
      else { baseRef.current = j.doc.updated_at; onMeta(j.doc); setSaveState(dirty.current ? "dirty" : "saved"); }
    } catch { dirty.current = true; setSaveState("error"); }
    saving.current = false;
    if (pending.current && !stopped.current) { pending.current = false; doSave(); }
  }, [doc.id, onMeta]);

  const markDirty = useCallback(() => {
    if (stopped.current) return;
    dirty.current = true; setSaveState("dirty");
    clearTimeout(timer.current);
    timer.current = setTimeout(doSave, SAVE_DELAY);
  }, [doSave]);

  const refreshCounts = (ed) => {
    const text = docText(ed.state.doc);
    totalRef.current = countWords(text);
    setChars(text.replace(/\n/g, "").length);
    clearTimeout(sectionTimer.current);
    sectionTimer.current = setTimeout(() => setSections(wordsBySection(ed.state.doc)), 400);
  };

  const editor = useEditor({
    extensions,
    content: doc.content && doc.content.type === "doc" ? doc.content : { type: "doc", content: [{ type: "paragraph" }] },
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editorProps: { attributes: { class: "ws-prose", spellcheck: "true", "aria-label": "Document text" } },
    onCreate: ({ editor: ed }) => {
      editorRef.current = ed;
      refreshCounts(ed);
      const next = ensureToday(diaryRef.current, totalRef.current);
      if (next !== diaryRef.current) { diaryRef.current = next; markDirty(); }
      bump();
    },
    onUpdate: ({ editor: ed }) => { refreshCounts(ed); markDirty(); },
  });

  // flush on leave; warn before closing the browser with unsaved changes
  useEffect(() => {
    const warn = (e) => { if (dirty.current || saving.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      clearTimeout(timer.current); clearTimeout(sectionTimer.current);
      if (dirty.current && !stopped.current) doSave();
    };
  }, [doSave]);

  // Ctrl/⌘+S saves now
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); clearTimeout(timer.current); doSave(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doSave]);

  const setPref = (key, setter) => (v) => { setter(v); writePref(key, v); };

  const newDay = () => {
    diaryRef.current = startNewEntry(diaryRef.current, totalRef.current);
    bump(); markDirty();
  };

  const jumpTo = (entryId) => {
    setFocusEntry(entryId);
    const el = editor?.view.dom.querySelector(`span[data-entry="${safeId(entryId)}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => setFocusEntry((x) => (x === entryId ? null : x)), 2200);
  };

  const doExport = async () => {
    if (!editor) return;
    setExporting(true);
    try { await exportDocx(editor.getJSON(), titleRef.current); }
    catch { alert("Couldn't create the Word file."); }
    setExporting(false);
  };

  const diary = diaryRef.current;
  const total = totalRef.current;
  const colorFor = (i) => diaryColor(i);
  const highlightCss = diary.map((e, i) => {
    const sel = `.ws-desk.marks span[data-entry="${safeId(e.id)}"]`;
    return `${sel}{background:${colorFor(i)}}` + (focusEntry === e.id ? `.ws-desk span[data-entry="${safeId(e.id)}"]{background:${colorFor(i)};box-shadow:0 0 0 2px var(--color-brand-700)}` : "");
  }).join("");

  const SAVE_LABEL = { saved: "Saved", dirty: "Unsaved changes", saving: "Saving…", error: "Couldn't save — retrying when you type", conflict: "Changed in another window" };

  return (
    <div className="ws-editor">
      <style>{highlightCss}</style>
      <div className="ws-titlebar">
        {!listOpen && <button className="ws-icon-btn light" onClick={onShowList} aria-label="Show documents" title="Show documents">☰</button>}
        <input className="ws-title" value={title} maxLength={200} aria-label="Document title"
          onChange={(e) => { setTitle(e.target.value); titleRef.current = e.target.value; markDirty(); }} />
        <span className={"ws-save " + saveState}>{SAVE_LABEL[saveState]}</span>
        <button className="ws-btn sm" onClick={doExport} disabled={exporting || !editor}>{exporting ? "Exporting…" : "Export .docx"}</button>
        <button className={"ws-btn sm" + (showDiary ? " on" : "")} onClick={() => setPref("ws.diary", setShowDiary)(!showDiary)} aria-pressed={showDiary}>Writing diary</button>
      </div>

      {saveState === "conflict" && (
        <div className="ws-banner">
          This document was saved from another window, so this copy stopped saving to protect that work.
          <button className="ws-btn sm" onClick={() => window.location.reload()}>Reload</button>
        </div>
      )}

      <Toolbar editor={editor} />

      <div className="ws-body">
        <div className={"ws-desk" + (showMarks ? " marks" : "")}>
          <div className="ws-page">
            <EditorContent editor={editor} />
          </div>
        </div>

        {showDiary && (
          <aside className="ws-diary" aria-label="Writing diary">
            <div className="ws-diary-head">
              <div>
                <div className="ws-diary-title">Writing diary</div>
                <div className="ws-diary-sub">{n(total)} words · {diary.length} {diary.length === 1 ? "entry" : "entries"}</div>
              </div>
              <button className="ws-icon-btn" onClick={() => setPref("ws.diary", setShowDiary)(false)} aria-label="Close diary">✕</button>
            </div>
            <div className="ws-diary-tools">
              <button className="ws-btn primary sm" onClick={newDay} title="Closes the current count and starts a new one. Earlier entries stay in the log.">Start new day</button>
              <label className="ws-check">
                <input type="checkbox" checked={showMarks} onChange={(e) => setPref("ws.marks", setShowMarks)(e.target.checked)} />
                Highlight sections
              </label>
            </div>
            <ol className="ws-entries">
              {[...diary].map((e, i) => ({ e, i })).reverse().map(({ e, i }) => {
                const net = entryWords(e, total);
                const inSection = sections[e.id] || 0;
                const open = !e.closedAt;
                return (
                  <li key={e.id}>
                    <button className={"ws-entry" + (focusEntry === e.id ? " focus" : "")} onClick={() => jumpTo(e.id)} disabled={!inSection} title={inSection ? "Show this section" : "No text from this entry is left in the document"}>
                      <span className="ws-swatch" style={{ background: colorFor(i) }} />
                      <span className="ws-entry-body">
                        <span className="ws-entry-date">
                          {e.kind === "imported" ? "Imported" : fmtDate(e.date)}
                          {open && <span className="ws-today">Current</span>}
                        </span>
                        <span className="ws-entry-line">
                          {e.kind === "imported" ? `${e.label || "Word file"} · ${fmtDate(e.date)}` : `Started ${fmtTime(e.startedAt)}${e.closedAt ? ` · ended ${fmtTime(e.closedAt)}` : ""}`}
                        </span>
                        <span className="ws-entry-counts">
                          <b className={net < 0 ? "neg" : ""}>{signed(net)}</b> words {e.kind === "imported" ? "imported" : "that day"}
                          <span className="ws-dot">·</span>{n(inSection)} in its sections
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <p className="ws-diary-note">Each entry's count is the net change in words while it was open, including edits to earlier sections. Edited text keeps its original day's highlight.</p>
          </aside>
        )}
      </div>

      <div className="ws-status">
        <span>{n(total)} words</span>
        <span>{n(chars)} characters</span>
        {openEntry(diary) && <span>Today: {signed(entryWords(openEntry(diary), total))} words</span>}
      </div>
    </div>
  );
}

/* ═══════════════════════ toolbar ═══════════════════════ */
function TB({ on, label, onClick, disabled, children, wide }) {
  return (
    <button type="button" className={"ws-tb" + (on ? " on" : "") + (wide ? " wide" : "")} onMouseDown={(e) => e.preventDefault()}
      onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={on === undefined ? undefined : !!on} title={label}>
      {children}
    </button>
  );
}

function Toolbar({ editor }) {
  if (!editor) return <div className="ws-toolbar" />;
  const c = () => editor.chain().focus();
  const ts = editor.getAttributes("textStyle");
  const style = editor.isActive("heading", { level: 1 }) ? "h1" : editor.isActive("heading", { level: 2 }) ? "h2"
    : editor.isActive("heading", { level: 3 }) ? "h3" : editor.isActive("blockquote") ? "quote" : "p";
  const setStyle = (v) => {
    if (v === "p") c().setParagraph().run();
    else if (v === "quote") { if (!editor.isActive("blockquote")) c().setParagraph().toggleBlockquote().run(); }
    else c().setHeading({ level: Number(v.slice(1)) }).run();
    if (v !== "quote" && editor.isActive("blockquote")) c().lift("blockquote").run();
  };
  const inList = editor.isActive("bulletList") || editor.isActive("orderedList");
  // clears formatting but never the writing-diary marks
  const clearFormatting = () => c().unsetMark("bold").unsetMark("italic").unsetMark("underline").unsetMark("strike")
    .unsetMark("code").unsetMark("textStyle").unsetMark("link").clearNodes().unsetTextAlign().run();
  const setLink = () => {
    const prev = editor.getAttributes("link").href || "";
    const url = window.prompt("Link address", prev);
    if (url === null) return;
    if (!url.trim()) c().extendMarkRange("link").unsetLink().run();
    else c().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };
  const align = ["left", "center", "right", "justify"].find((a) => editor.isActive({ textAlign: a })) || "left";

  return (
    <div className="ws-toolbar" role="toolbar" aria-label="Formatting">
      <div className="ws-tb-group">
        <TB label="Undo (Ctrl+Z)" onClick={() => c().undo().run()} disabled={!editor.can().undo()}>↶</TB>
        <TB label="Redo (Ctrl+Y)" onClick={() => c().redo().run()} disabled={!editor.can().redo()}>↷</TB>
      </div>
      <div className="ws-tb-group">
        <select className="ws-select" value={style} onChange={(e) => setStyle(e.target.value)} aria-label="Paragraph style">
          <option value="p">Normal</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option><option value="quote">Quote</option>
        </select>
        <select className="ws-select" value={ts.fontFamily || ""} aria-label="Font"
          onChange={(e) => (e.target.value ? c().setFontFamily(e.target.value).run() : c().unsetFontFamily().run())}>
          {FONTS.map(([v, l]) => <option key={l} value={v}>{l}</option>)}
          {ts.fontFamily && !FONTS.some(([v]) => v === ts.fontFamily) && <option value={ts.fontFamily}>{String(ts.fontFamily).split(",")[0].replace(/['"]/g, "")}</option>}
        </select>
        <select className="ws-select narrow" value={ts.fontSize || ""} aria-label="Font size"
          onChange={(e) => (e.target.value ? c().setFontSize(e.target.value).run() : c().unsetFontSize().run())}>
          {SIZES.map((s) => <option key={s || "d"} value={s}>{s ? s.replace("pt", "") : "Size"}</option>)}
          {ts.fontSize && !SIZES.includes(ts.fontSize) && <option value={ts.fontSize}>{ts.fontSize}</option>}
        </select>
      </div>
      <div className="ws-tb-group">
        <TB label="Bold (Ctrl+B)" on={editor.isActive("bold")} onClick={() => c().toggleBold().run()}><b>B</b></TB>
        <TB label="Italic (Ctrl+I)" on={editor.isActive("italic")} onClick={() => c().toggleItalic().run()}><i>I</i></TB>
        <TB label="Underline (Ctrl+U)" on={editor.isActive("underline")} onClick={() => c().toggleUnderline().run()}><u>U</u></TB>
        <TB label="Strikethrough" on={editor.isActive("strike")} onClick={() => c().toggleStrike().run()}><s>S</s></TB>
        <label className="ws-tb ws-color" title="Text color">
          <span style={{ borderBottom: `3px solid ${ts.color || "#1D1D1F"}` }}>A</span>
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(ts.color || "") ? ts.color : "#1d1d1f"} aria-label="Text color"
            onChange={(e) => c().setColor(e.target.value).run()} />
        </label>
        <TB label="Link" on={editor.isActive("link")} onClick={setLink}>🔗</TB>
      </div>
      <div className="ws-tb-group">
        {[["left", "Align left", "M4 6h16M4 10h10M4 14h16M4 18h10"], ["center", "Center", "M4 6h16M7 10h10M4 14h16M7 18h10"],
          ["right", "Align right", "M4 6h16M10 10h10M4 14h16M10 18h10"], ["justify", "Justify", "M4 6h16M4 10h16M4 14h16M4 18h16"]].map(([a, l, d]) => (
          <TB key={a} label={l} on={align === a} onClick={() => c().setTextAlign(a).run()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d={d} /></svg>
          </TB>
        ))}
      </div>
      <div className="ws-tb-group">
        <TB label="Bulleted list" on={editor.isActive("bulletList")} onClick={() => c().toggleBulletList().run()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" fill="currentColor" /><circle cx="4.5" cy="12" r="1" fill="currentColor" /><circle cx="4.5" cy="18" r="1" fill="currentColor" /></svg>
        </TB>
        <TB label="Numbered list" on={editor.isActive("orderedList")} onClick={() => c().toggleOrderedList().run()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M10 6h10M10 12h10M10 18h10" /><text x="2" y="8" fontSize="7" fill="currentColor" stroke="none">1</text><text x="2" y="14" fontSize="7" fill="currentColor" stroke="none">2</text><text x="2" y="20" fontSize="7" fill="currentColor" stroke="none">3</text></svg>
        </TB>
        <TB label="Decrease indent" disabled={!inList || !editor.can().liftListItem("listItem")} onClick={() => c().liftListItem("listItem").run()}>⇤</TB>
        <TB label="Increase indent" disabled={!inList || !editor.can().sinkListItem("listItem")} onClick={() => c().sinkListItem("listItem").run()}>⇥</TB>
      </div>
      <div className="ws-tb-group">
        <TB label="Horizontal line" onClick={() => c().setHorizontalRule().run()}>―</TB>
        <TB label="Clear formatting" onClick={clearFormatting} wide>Clear</TB>
      </div>
    </div>
  );
}
