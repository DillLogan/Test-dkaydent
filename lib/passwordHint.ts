/** Rules for a customer's optional password hint. Anyone who types the username can see it, so it must not give the password away. */
export const HINT_MAX = 100;

export function hintProblem(hint: string, password: string): string | null {
  const h = hint.trim();
  if (!h) return null;
  if (h.length > HINT_MAX) return `Keep the hint to ${HINT_MAX} characters or fewer.`;
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const hs = squash(h), ps = squash(password);
  if (ps && (hs.includes(ps) || (ps.length >= 4 && hs.includes(ps.slice(0, Math.ceil(ps.length * 0.6)))))) {
    return "The hint can't contain your password or most of it.";
  }
  return null;
}
