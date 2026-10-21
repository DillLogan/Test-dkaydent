/** CSV helpers shared by export (server) and import (browser). */

export type Column<T> = { key: string; label?: string; get?: (row: T) => unknown };

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "boolean" ? (v ? "true" : "false") : String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV<T>(rows: T[], columns: Column<T>[]): string {
  const header = columns.map((c) => cell(c.label ?? c.key)).join(",");
  const body = rows.map((r) => columns.map((c) => cell(c.get ? c.get(r) : (r as any)[c.key])).join(","));
  return [header, ...body].join("\r\n") + "\r\n";
}

/** RFC 4180 parser: quoted fields, escaped quotes, CRLF/LF, optional BOM. */
export function parseCSV(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Parse into objects keyed by normalized header (lowercase, spaces → _). */
export function parseCSVObjects(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const [head, ...body] = parseCSV(text);
  if (!head) return { headers: [], rows: [] };
  const headers = head.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  return {
    headers,
    rows: body.map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()]))),
  };
}

/** "bunch=25; box=250" → [{name, factor}] */
export function parseUnits(s: string): { name: string; factor: number }[] | string {
  if (!s.trim()) return [];
  const out: { name: string; factor: number }[] = [];
  for (const part of s.split(/[;|]/)) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^([a-zA-Z][\w\s.-]*?)\s*=\s*([\d.]+)$/);
    if (!m || !(Number(m[2]) > 0)) return `Units must look like "bunch=25; box=250" (got "${p}")`;
    out.push({ name: m[1].trim().toLowerCase(), factor: Number(m[2]) });
  }
  return out;
}

export const truthy = (s: string | undefined, dflt = true) =>
  s === undefined || s.trim() === "" ? dflt : /^(true|yes|y|1|active)$/i.test(s.trim());
