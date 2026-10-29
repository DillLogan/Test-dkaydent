// @ts-nocheck — ported as-is from the BrightStar CRM handoff (Word .docx import/export)
/* Word (.docx) import and export for Wordsmith. Both run in the browser;
   the `docx` and `mammoth` libraries load only when used.
   Diary highlights are not exported — the file holds the writing only. */

const PT_PER_PX = 0.75;
function halfPoints(size) {
  if (!size) return undefined;
  const m = String(size).trim().match(/^([\d.]+)\s*(pt|px)?$/i);
  if (!m) return undefined;
  const pt = (m[2] || "pt").toLowerCase() === "px" ? parseFloat(m[1]) * PT_PER_PX : parseFloat(m[1]);
  return Math.round(pt * 2);
}
function hexColor(c) {
  if (!c) return undefined;
  let s = String(c).trim();
  const rgb = s.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgb) return rgb.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase();
  if (s.startsWith("#")) s = s.slice(1);
  if (s.length === 3) s = s.split("").map((ch) => ch + ch).join("");
  return /^[0-9a-f]{6}$/i.test(s) ? s.toUpperCase() : undefined;
}
function firstFont(f) {
  if (!f) return undefined;
  return String(f).split(",")[0].replace(/["']/g, "").trim() || undefined;
}

export async function exportDocx(json, title) {
  const d = await import("docx");
  const { Document, Packer, Paragraph, TextRun, ExternalHyperlink, HeadingLevel, AlignmentType, LevelFormat, BorderStyle } = d;

  const ALIGN = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED };
  const HEAD = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3, 4: HeadingLevel.HEADING_4 };

  let numberedLists = 0; // each ordered list restarts at 1

  const runsFor = (nodes = [], extra = {}) => {
    const out = [];
    for (const n of nodes) {
      if (n.type === "hardBreak") { out.push(new TextRun({ break: 1 })); continue; }
      if (n.type !== "text") continue;
      const marks = n.marks || [];
      const has = (t) => marks.some((m) => m.type === t);
      const ts = marks.find((m) => m.type === "textStyle")?.attrs || {};
      const link = marks.find((m) => m.type === "link")?.attrs?.href;
      const opts = {
        text: n.text,
        bold: has("bold") || undefined,
        italics: has("italic") || extra.italics || undefined,
        underline: has("underline") || link ? {} : undefined,
        strike: has("strike") || undefined,
        color: link ? "0563C1" : hexColor(ts.color),
        size: halfPoints(ts.fontSize),
        font: has("code") || extra.mono ? "Courier New" : firstFont(ts.fontFamily),
      };
      const run = new TextRun(opts);
      out.push(link && /^https?:|^mailto:/i.test(link) ? new ExternalHyperlink({ link, children: [run] }) : run);
    }
    return out;
  };

  const blocks = (nodes = [], ctx = {}) => {
    const out = [];
    for (const n of nodes) {
      const align = ALIGN[n.attrs?.textAlign];
      switch (n.type) {
        case "paragraph":
          out.push(new Paragraph({
            children: runsFor(n.content, ctx),
            alignment: align,
            indent: ctx.quote ? { left: 720 } : undefined,
            ...(ctx.list ? (ctx.list.ordered
              ? { numbering: { reference: "ws-numbers", level: ctx.list.level, instance: ctx.list.instance } }
              : { bullet: { level: ctx.list.level } }) : {}),
          }));
          break;
        case "heading":
          out.push(new Paragraph({ children: runsFor(n.content), heading: HEAD[n.attrs?.level] || HeadingLevel.HEADING_1, alignment: align }));
          break;
        case "blockquote":
          out.push(...blocks(n.content, { ...ctx, quote: true, italics: true }));
          break;
        case "codeBlock":
          out.push(new Paragraph({ children: runsFor(n.content, { mono: true }) }));
          break;
        case "horizontalRule":
          out.push(new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } } }));
          break;
        case "bulletList":
        case "orderedList": {
          const ordered = n.type === "orderedList";
          const level = ctx.list ? ctx.list.level + 1 : 0;
          const instance = ordered ? (ctx.list?.ordered && level > 0 ? ctx.list.instance : ++numberedLists) : 0;
          for (const li of n.content || []) {
            // first paragraph carries the number/bullet; nested lists go one level deeper
            const kids = li.content || [];
            kids.forEach((k, idx) => {
              if (k.type === "paragraph" && idx === 0) out.push(...blocks([k], { ...ctx, list: { ordered, level, instance } }));
              else if (k.type === "paragraph") out.push(new Paragraph({ children: runsFor(k.content), indent: { left: 720 * (level + 1) } }));
              else out.push(...blocks([k], { ...ctx, list: { ordered, level, instance } }));
            });
          }
          break;
        }
        default:
          if (n.content) out.push(...blocks(n.content, ctx));
      }
    }
    return out;
  };

  const children = blocks(json?.content || []);
  const doc = new Document({
    title: title || "Document",
    creator: "BrightStar Wordsmith",
    styles: { default: { document: { run: { font: "Calibri", size: 24 } } } },
    numbering: {
      config: [{
        reference: "ws-numbers",
        levels: [0, 1, 2, 3, 4].map((level) => ({
          level, format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN, LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER][level],
          text: `%${level + 1}.`, alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
        })),
      }],
    },
    sections: [{
      // US Letter, 1-inch margins (twips)
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children: children.length ? children : [new Paragraph("")],
    }],
  });
  const blob = await Packer.toBlob(doc);
  const name = (String(title || "Document").replace(/[\\/:*?"<>|]+/g, " ").trim() || "Document") + ".docx";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* Read a .docx in the browser and return HTML (images are dropped). */
export async function importDocxHtml(file) {
  const mod = await import("mammoth/mammoth.browser.min.js");
  const mammoth = mod.default || mod;
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer }, {
    convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: "" })),
    styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh", "p[style-name='Quote'] => blockquote > p:fresh"],
  });
  return result.value.replace(/<img[^>]*>/gi, "");
}
