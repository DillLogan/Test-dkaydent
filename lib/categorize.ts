export type CategoryRule = { id?: string; keyword: string; category: string; kind: "flower" | "hard_good" | null; priority?: number };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Best rule for an item name. Same logic as the database's categorize():
 * the keyword must start a word; the longest keyword wins, then priority.
 */
export function categorize(name: string, rules: CategoryRule[]): CategoryRule | null {
  const hits = rules.filter((r) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${esc(r.keyword.trim())}`, "iu").test(name));
  if (!hits.length) return null;
  hits.sort(
    (a, b) => b.keyword.length - a.keyword.length || (a.priority ?? 100) - (b.priority ?? 100) || a.keyword.localeCompare(b.keyword),
  );
  return hits[0];
}
