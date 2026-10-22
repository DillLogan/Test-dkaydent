import { redirect } from "next/navigation";

/** Redirect back with an error message shown by <ErrorBanner>. Never call inside try/catch. */
export function fail(path: string, message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);
}

export function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

export function num(fd: FormData, key: string): number | null {
  const s = str(fd, key);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function int(fd: FormData, key: string): number | null {
  const n = num(fd, key);
  return n === null ? null : Math.round(n);
}

export function bool(fd: FormData, key: string): boolean {
  return fd.get(key) === "on" || fd.get(key) === "true";
}

/** Turn a Postgres / PostgREST error into something readable. */
export function dbMessage(error: { message: string; code?: string } | null): string {
  if (!error) return "Unknown error";
  if (error.code === "23505") return "That already exists (duplicate value).";
  if (error.code === "23503") return "It's still in use elsewhere, so it can't be removed.";
  if (error.message.includes("row-level security")) return "Your role doesn't allow that change.";
  return error.message;
}

/** Strip characters that would break a PostgREST `or=` filter. */
export function searchTerm(q: string | undefined): string | null {
  const s = (q ?? "").replace(/[,()*%\\]/g, " ").trim();
  return s ? s : null;
}
