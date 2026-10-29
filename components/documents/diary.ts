// @ts-nocheck — ported as-is from the BrightStar CRM handoff (Wordsmith writing diary)
/* ─────────────────────────────────────────────────────────────────────
   Writing diary (Wordsmith, build 124)

   Every piece of text carries a `diaryDay` mark whose `entry` attribute
   points at one diary entry: { id, date, startedAt, closedAt, baseline,
   words, kind, label }.

   Rules (as agreed with Logan):
   • New text is credited to the entry that is open when it's typed.
   • A new entry opens automatically when the calendar day changes, or when
     the writer presses "Start new day". Earlier entries stay in the log.
   • Editing older text leaves it on its original day (the mark is kept),
     but the change in word count is credited to the day the edit was made:
     an entry's count = total words when it closed − total words when it
     opened (`baseline`).
   ───────────────────────────────────────────────────────────────────── */
import { Mark, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export const DIARY_COLORS = ["#FFF1A8", "#CFE8FF", "#D6F2CC", "#FFD6DE", "#E4DAFF", "#FFDFBF", "#CCF0EC", "#EFE2CC"];
export const diaryColor = (i) => DIARY_COLORS[i % DIARY_COLORS.length];

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu;
export function countWords(text) {
  const m = (text || "").match(WORD_RE);
  return m ? m.length : 0;
}

export function newEntryId() {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return "d" + Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}
export const safeId = (id) => String(id || "").replace(/[^\w-]/g, "");

/* Local calendar date as YYYY-MM-DD. */
export function todayLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function openEntry(diary) {
  const last = diary[diary.length - 1];
  return last && !last.closedAt ? last : null;
}

/* Close the open entry (freezing its count) and start a new one. */
export function startNewEntry(diary, totalWords, now = new Date()) {
  const out = diary.map((e) => (e.closedAt ? e : { ...e, closedAt: now.toISOString(), words: totalWords - (e.baseline || 0) }));
  out.push({ id: newEntryId(), kind: "day", date: todayLocal(now), startedAt: now.toISOString(), closedAt: null, baseline: totalWords, words: 0 });
  return out;
}

/* Make sure an entry for today is open. Returns the same array when nothing changes. */
export function ensureToday(diary, totalWords, now = new Date()) {
  const cur = openEntry(diary);
  if (cur && cur.date === todayLocal(now)) return diary;
  return startNewEntry(diary, totalWords, now);
}

/* Net words credited to an entry (live for the open one). */
export function entryWords(e, totalWords) {
  return e.closedAt ? (e.words || 0) : totalWords - (e.baseline || 0);
}

/* Whole-document plain text, blocks separated by newlines. */
export function docText(doc) {
  return doc.textBetween(0, doc.content.size, "\n", "\n");
}

/* Words currently sitting in each entry's highlighted sections. */
export function wordsBySection(doc, markName = "diaryDay") {
  const parts = {};
  doc.descendants((node) => {
    if (!node.isTextblock) return true;
    let prev = null;
    node.forEach((child) => {
      if (!child.isText) { prev = null; return; }
      const m = child.marks.find((x) => x.type.name === markName);
      const id = m?.attrs.entry || "_none";
      if (!parts[id]) parts[id] = [];
      // join pieces of the same section inside a paragraph without a gap so
      // a word split by bold/italic isn't counted twice
      if (prev === id) parts[id][parts[id].length - 1] += child.text;
      else parts[id].push(child.text);
      prev = id;
    });
    return false;
  });
  const out = {};
  for (const id of Object.keys(parts)) out[id] = countWords(parts[id].join(" "));
  return out;
}

/* The mark itself, plus a plugin that stamps any unmarked new text with the
   open entry. `getEntry()` returns the open entry's id (or null). */
export const DiaryDay = Mark.create({
  name: "diaryDay",
  inclusive: false,      // typing right after an older section starts today's text
  spanning: true,
  addOptions() { return { getEntry: () => null }; },
  addAttributes() {
    return {
      entry: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-entry"),
        renderHTML: (a) => (a.entry ? { "data-entry": safeId(a.entry) } : {}),
      },
    };
  },
  parseHTML() { return [{ tag: "span[data-entry]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", mergeAttributes(HTMLAttributes, { class: "ws-day" }), 0]; },
  addProseMirrorPlugins() {
    const type = this.type;
    const getEntry = () => this.options.getEntry();
    return [
      new Plugin({
        key: new PluginKey("diaryDayStamp"),
        appendTransaction(trs, _old, state) {
          if (!trs.some((tr) => tr.docChanged)) return null;
          const entry = getEntry();
          if (!entry) return null;
          // collect the ranges these transactions inserted, mapped to the final doc
          let ranges = [];
          for (const tr of trs) {
            ranges = ranges.map((r) => ({ from: tr.mapping.map(r.from, -1), to: tr.mapping.map(r.to, 1) }));
            tr.mapping.maps.forEach((map, i) => {
              map.forEach((_os, _oe, ns, ne) => {
                let from = ns, to = ne;
                for (let j = i + 1; j < tr.mapping.maps.length; j++) {
                  from = tr.mapping.maps[j].map(from, -1);
                  to = tr.mapping.maps[j].map(to, 1);
                }
                if (to > from) ranges.push({ from, to });
              });
            });
          }
          if (!ranges.length) return null;
          const tr = state.tr;
          const size = state.doc.content.size;
          for (const r of ranges) {
            const from = Math.max(0, r.from), to = Math.min(size, r.to);
            if (to <= from) continue;
            state.doc.nodesBetween(from, to, (node, pos) => {
              if (!node.isText) return true;
              if (node.marks.some((m) => m.type === type)) return false;
              tr.addMark(Math.max(pos, from), Math.min(pos + node.nodeSize, to), type.create({ entry }));
              return false;
            });
          }
          return tr.steps.length ? tr : null;
        },
      }),
    ];
  },
});

/* Stamp every text node in a TipTap JSON document with one entry (used for imports). */
export function stampJSON(json, entry) {
  const walk = (n) => {
    if (!n || typeof n !== "object") return n;
    if (n.type === "text") {
      const marks = (n.marks || []).filter((m) => m.type !== "diaryDay");
      return { ...n, marks: [...marks, { type: "diaryDay", attrs: { entry } }] };
    }
    return n.content ? { ...n, content: n.content.map(walk) } : n;
  };
  return walk(json);
}
