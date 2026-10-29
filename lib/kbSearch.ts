/**
 * Knowledge base search: ranks articles and tutorials by how well they match, and marks the matching words.
 * Pure functions, no dependencies: the same file runs in the app and the demo.
 *
 * Scoring per query word, best match wins: exact word 3, same stem (roses → rose, printing → print) 2.5,
 * word starts with it 2, contains it 1 (4+ letters). Weighted by where it hits: title ×4, category ×2, text ×1.
 * Every word must match somewhere; if nothing matches all of them, documents matching most of them are shown as partial.
 * The whole phrase appearing in the title or text adds a bonus.
 */
export type KbDoc = { id: string; kind: "article" | "tutorial"; title: string; category: string; text: string[]; href?: string; custom?: boolean };
export type KbHit = { doc: KbDoc; score: number; partial: boolean; terms: string[] };

const STOP = new Set(["a", "an", "the", "to", "of", "and", "or", "is", "are", "in", "on", "for", "how", "do", "does", "i", "my", "can", "what", "with", "it", "be", "at", "by", "from", "when", "where", "why", "you", "your"]);

export const words = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]+/g) ?? [];

/** A rough English stem, enough to match roses/rose, printing/print, labels/label, boxes/box, pulled/pull. */
export function stem(w: string) {
  if (w.length <= 3) return w;
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("lves")) return w.slice(0, -3) + "f"; // shelves → shelf
  if (/(x|z|ch|sh|ss)es$/.test(w)) return w.slice(0, -2); // boxes → box
  for (const suf of ["ings", "ing", "edly", "ed", "s", "ly"]) {
    if (w.endsWith(suf) && !w.endsWith("ss") && w.length - suf.length >= 3) return w.slice(0, -suf.length);
  }
  return w;
}

/** The query's meaningful words (stop words dropped unless that is all there is). */
export function queryTerms(q: string) {
  const all = words(q);
  const kept = all.filter((w) => !STOP.has(w));
  return [...new Set(kept.length ? kept : all)];
}

function termScore(term: string, field: string[]) {
  const st = stem(term);
  let best = 0;
  for (const w of field) {
    const s = w === term ? 3 : stem(w) === st ? 2.5 : w.startsWith(term) ? 2 : term.length >= 4 && w.includes(term) ? 1 : 0;
    if (s > best) best = s;
    if (best === 3) break;
  }
  return best;
}

export function searchKb(docs: KbDoc[], q: string): KbHit[] {
  const terms = queryTerms(q);
  if (!terms.length) return docs.map((doc) => ({ doc, score: 0, partial: false, terms }));
  const phrase = words(q).join(" ");
  const scored = docs.map((doc) => {
    const title = words(doc.title);
    const cat = words(doc.category);
    const body = words(doc.text.join(" "));
    let score = 0;
    let matched = 0;
    for (const t of terms) {
      const s = Math.max(termScore(t, title) * 4, termScore(t, cat) * 2, termScore(t, body));
      if (s > 0) matched++;
      score += s;
    }
    if (terms.length > 1 && phrase.length > 3) {
      if (title.join(" ").includes(phrase)) score += 6;
      else if (body.join(" ").includes(phrase)) score += 3;
    }
    return { doc, score, matched };
  });
  const full = scored.filter((x) => x.matched === terms.length);
  const pool = full.length ? full : scored.filter((x) => x.matched > 0 && x.matched >= Math.ceil(terms.length / 2));
  return pool
    .sort((a, b) => b.score - a.score || (a.doc.kind === b.doc.kind ? a.doc.title.localeCompare(b.doc.title) : a.doc.kind === "article" ? -1 : 1))
    .map((x) => ({ doc: x.doc, score: x.score, partial: !full.length, terms }));
}

/** Splits text into plain and matching pieces, for <mark>-ing the words that matched. */
export function highlight(text: string, terms: string[]): { t: string; hit: boolean }[] {
  if (!terms.length || !text) return [{ t: text, hit: false }];
  const stems = terms.map(stem);
  const out: { t: string; hit: boolean }[] = [];
  const re = /[A-Za-z0-9À-ɏ]+|[^A-Za-z0-9À-ɏ]+/g;
  for (const piece of text.match(re) ?? []) {
    const w = words(piece)[0];
    const hit = !!w && terms.some((t, i) => w === t || stem(w) === stems[i] || w.startsWith(t) || (t.length >= 4 && w.includes(t)));
    const last = out[out.length - 1];
    if (last && last.hit === hit) last.t += piece;
    else out.push({ t: piece, hit });
  }
  return out;
}

/** The best sentence-sized snippet for a result: the body line with the most matching words. */
export function bestLine(doc: KbDoc, terms: string[]) {
  if (!terms.length) return doc.text[0] ?? "";
  let best = doc.text[0] ?? "";
  let n = -1;
  for (const line of doc.text) {
    const c = highlight(line, terms).filter((p) => p.hit).length;
    if (c > n) {
      n = c;
      best = line;
    }
  }
  return best;
}
