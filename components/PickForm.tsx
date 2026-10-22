"use client";

import { useMemo, useState } from "react";
import { ScanInput } from "./ScanInput";
import { SubmitButton } from "./SubmitButton";

export type PickLot = {
  lot_id: string;
  lot_code: string;
  location: string;
  received: string;
  expires: string;
  days_to_expiry: number | null;
  available: number;
};
export type PickLine = {
  id: string;
  product: string;
  sku: string;
  base_unit: string;
  need: number;
  lots: PickLot[];
};

const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);

/** Oldest-first suggestion, matching what automatic fulfillment would do. */
function suggest(lines: PickLine[]) {
  const q: Record<string, number> = {};
  for (const l of lines) {
    let need = l.need;
    for (const lot of l.lots) {
      const take = Math.min(need, lot.available);
      q[`${l.id}:${lot.lot_id}`] = take > 0 ? take : 0;
      need -= Math.max(take, 0);
    }
  }
  return q;
}

export function PickForm({ lines, action }: { lines: PickLine[]; action: (fd: FormData) => void }) {
  const [qty, setQty] = useState<Record<string, number>>(() => suggest(lines));
  const [flash, setFlash] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const l of lines) t[l.id] = l.lots.reduce((s, lot) => s + (qty[`${l.id}:${lot.lot_id}`] || 0), 0);
    return t;
  }, [qty, lines]);

  const picks = lines.flatMap((l) =>
    l.lots
      .map((lot) => ({ so_line_id: l.id, lot_id: lot.lot_id, qty_base: qty[`${l.id}:${lot.lot_id}`] || 0 }))
      .filter((p) => p.qty_base > 0),
  );
  const allMatch = lines.every((l) => Math.abs(totals[l.id] - l.need) < 1e-9);

  const onScan = (code: string) => {
    const c = code.toUpperCase();
    for (const l of lines) {
      const lot = l.lots.find((x) => x.lot_code.toUpperCase() === c);
      if (!lot) continue;
      const key = `${l.id}:${lot.lot_id}`;
      // Scanning a lot makes it the source for this line: fill from it first, then clear others as needed
      const fromLot = Math.min(l.need, lot.available);
      const next = { ...qty };
      let remaining = l.need - fromLot;
      next[key] = fromLot;
      for (const other of l.lots) {
        if (other.lot_id === lot.lot_id) continue;
        const k = `${l.id}:${other.lot_id}`;
        const keep = Math.min(next[k] || 0, remaining);
        next[k] = keep;
        remaining -= keep;
      }
      setQty(next);
      setFlash(key);
      setMessage(`${lot.lot_code} → ${fmt(fromLot)} ${l.base_unit} of ${l.product}`);
      setTimeout(() => setFlash(null), 1200);
      return;
    }
    setMessage(`${code} isn't an available lot for any line on this order.`);
  };

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="picks" value={JSON.stringify(picks)} />
      <div className="card space-y-2">
        <div className="label">Scan lot labels to pick from them</div>
        <ScanInput onCode={onScan} placeholder="Scan or type a lot code" />
        {message && <p className="text-sm text-stone-600">{message}</p>}
      </div>

      {lines.map((l) => {
        const ok = Math.abs(totals[l.id] - l.need) < 1e-9;
        return (
          <div key={l.id} className="table-wrap">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stone-200 bg-stone-50 px-3 py-2">
              <div>
                <span className="font-medium">{l.product}</span>{" "}
                <span className="font-mono text-xs text-stone-500">{l.sku}</span>
              </div>
              <div className={`text-sm tabular-nums ${ok ? "text-brand-700" : "font-medium text-amber-700"}`}>
                Picked {fmt(totals[l.id])} of {fmt(l.need)} {l.base_unit}
              </div>
            </div>
            {l.lots.length === 0 ? (
              <p className="px-3 py-3 text-sm text-red-700">No stock on hand.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Lot</th>
                    <th>Location</th>
                    <th>Received</th>
                    <th>Expires</th>
                    <th className="num">Available</th>
                    <th className="num">Pick ({l.base_unit})</th>
                  </tr>
                </thead>
                <tbody>
                  {l.lots.map((lot) => {
                    const key = `${l.id}:${lot.lot_id}`;
                    return (
                      <tr key={lot.lot_id} className={flash === key ? "bg-brand-50" : ""}>
                        <td className="font-mono text-xs">{lot.lot_code}</td>
                        <td>{lot.location}</td>
                        <td>{lot.received}</td>
                        <td className={lot.days_to_expiry !== null && lot.days_to_expiry <= 3 ? "font-medium text-amber-700" : ""}>
                          {lot.expires}
                        </td>
                        <td className="num">{fmt(lot.available)}</td>
                        <td className="num">
                          <input
                            type="number"
                            min={0}
                            max={lot.available}
                            step="any"
                            className="input ml-auto w-24 text-right"
                            value={qty[key] ?? 0}
                            onChange={(e) =>
                              setQty({ ...qty, [key]: Math.max(0, Math.min(lot.available, Number(e.target.value) || 0)) })
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn" onClick={() => setQty(suggest(lines))}>
          Reset to oldest-first
        </button>
        <SubmitButton pendingText="Pulling stock…">Fulfill with these lots</SubmitButton>
        {!allMatch && <span className="text-sm text-amber-700">Each line's picks must equal what it needs.</span>}
      </div>
    </form>
  );
}
