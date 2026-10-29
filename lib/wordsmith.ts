/** Checks for Word editor documents (ported from the BrightStar CRM handoff). Each person's documents are private (RLS). */
export const LIST_COLS = "id, title, word_count, created_at, updated_at";
const MAX_CONTENT_CHARS = 4_000_000;
const MAX_DIARY = 5000;

export class BadInput extends Error {}

export function cleanDoc(b: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (b.title !== undefined || !partial) out.title = (typeof b.title === "string" ? b.title.trim().slice(0, 200) : "") || "Untitled document";
  if (b.content !== undefined || !partial) {
    const c = b.content ?? { type: "doc", content: [] };
    if (typeof c !== "object" || Array.isArray(c)) throw new BadInput("Document content is invalid.");
    if (JSON.stringify(c).length > MAX_CONTENT_CHARS) throw new BadInput("This document is too large to save. Split it into two documents.");
    out.content = c;
  }
  if (b.diary !== undefined || !partial) {
    const d = b.diary ?? [];
    if (!Array.isArray(d) || d.length > MAX_DIARY) throw new BadInput("Diary data is invalid.");
    out.diary = d;
  }
  if (b.word_count !== undefined || !partial) out.word_count = Math.max(0, Math.min(Math.floor(Number(b.word_count) || 0), 10_000_000));
  return out;
}
