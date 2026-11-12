"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SubmitButton } from "./SubmitButton";

type Unit = { id: string; name: string; factor: number };
type Lot = { id: string; code: string; locationId: string; locationName: string; received: string; expires: string | null; qty: number };
type Place = { id: string; name: string; qty?: number };

const fmt = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString();

function Modal({ label, onClose, children, testId }: { label: string; onClose: () => void; children: React.ReactNode; testId: string }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  // portalled so the page's own layers can't sit on top of it
  return createPortal(
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-testid={testId}
        className="fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white p-5 text-left shadow-2xl"
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

/** On hand number with a pencil to count the whole product (this location only when the list is filtered) */
export function CountCell({
  productId,
  baseUnit,
  onHand,
  totalAll,
  committed,
  units,
  lots,
  locations,
  scopeLocation,
  back,
  action,
}: {
  productId: string;
  baseUnit: string;
  onHand: number;
  totalAll: number;
  committed: number;
  units: Unit[];
  lots: Lot[];
  locations: Place[];
  scopeLocation: string | null;
  back: string;
  action: (fd: FormData) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(String(onHand));
  const [unitId, setUnitId] = useState(units[0]?.id ?? "");
  const [warn, setWarn] = useState<number | null>(null);
  const [higher, setHigher] = useState(false);
  const [into, setInto] = useState<string>(lots[lots.length - 1]?.id ?? "new");
  const [newLoc, setNewLoc] = useState(scopeLocation ?? lots[lots.length - 1]?.locationId ?? locations[0]?.id ?? "");
  const form = useRef<HTMLFormElement>(null);
  const pass = useRef(false);

  const factor = units.find((u) => u.id === unitId)?.factor ?? 1;
  const counted = Number(qty) * factor;
  const diff = counted - onHand;

  function reset() {
    setEditing(false);
    setWarn(null);
    setHigher(false);
    setQty(String(onHand));
    setUnitId(units[0]?.id ?? "");
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (pass.current) {
      pass.current = false;
      return;
    }
    if (qty.trim() === "" || !(counted >= 0)) {
      e.preventDefault();
      return;
    }
    if (diff < 0) {
      // what's on open orders that this count leaves uncovered
      const newlyShort = Math.max(0, committed - (totalAll + diff)) - Math.max(0, committed - totalAll);
      if (newlyShort > 0 && warn === null) {
        e.preventDefault();
        setWarn(newlyShort);
      }
    } else if (diff > 0) {
      e.preventDefault();
      setHigher(true);
    }
  }

  function go() {
    pass.current = true;
    form.current?.requestSubmit();
  }

  if (!editing)
    return (
      <span className="inline-flex items-center justify-end gap-1.5">
        <span>
          {fmt(onHand)} {baseUnit}
        </span>
        <button
          type="button"
          className="rounded-full p-1 text-stone-400 hover:bg-stone-100 hover:text-brand-700"
          onClick={() => setEditing(true)}
          aria-label="Edit on hand count"
          title="Edit on hand count"
          data-testid="edit-count"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
      </span>
    );

  return (
    <form ref={form} action={action} onSubmit={onSubmit} className="inline-flex flex-col items-end gap-1.5" data-testid="count-form">
      <input type="hidden" name="product_id" value={productId} />
      <input type="hidden" name="location_id" value={scopeLocation ?? ""} />
      <input type="hidden" name="expected" value={onHand} />
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="into_lot" value={higher && into !== "new" ? into : ""} />
      <input type="hidden" name="new_lot_location" value={higher && into === "new" ? newLoc : ""} />
      <span className="flex items-center gap-1.5">
        <input
          name="qty"
          type="number"
          min="0"
          step="any"
          required
          autoFocus
          value={qty}
          onChange={(e) => {
            setQty(e.target.value);
            setWarn(null);
          }}
          className="input w-24 text-right"
          aria-label="Counted"
        />
        {units.length > 1 ? (
          <select name="unit_id" value={unitId} onChange={(e) => setUnitId(e.target.value)} className="input w-auto" aria-label="Unit">
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input type="hidden" name="unit_id" value={unitId} />
            <span className="text-sm text-stone-500">{baseUnit}</span>
          </>
        )}
      </span>
      {committed > 0 && (
        <span className="text-xs text-stone-500">
          {fmt(committed)} {baseUnit} on open orders
        </span>
      )}
      {warn !== null && (
        <span className="max-w-64 text-xs text-amber-800" role="alert" data-testid="count-warn">
          {fmt(warn)} {baseUnit} on open orders would move to a backorder.
        </span>
      )}
      <span className="flex gap-1.5">
        <button type="button" className="btn btn-sm" onClick={reset}>
          Cancel
        </button>
        <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…">
          {warn !== null ? "Save anyway" : "Save"}
        </SubmitButton>
      </span>

      {higher && (
        <Modal label="Higher than expected" onClose={() => setHigher(false)} testId="count-higher">
          <h3 className="text-lg font-semibold text-stone-900">Higher than expected</h3>
          <p className="mt-1 text-sm text-stone-600">
            {fmt(onHand)} {baseUnit} on hand, you entered {fmt(counted)} (+{fmt(diff)} {baseUnit}). Allow it, and choose where the extra
            goes.
          </p>
          <fieldset className="mt-4 space-y-2">
            <legend className="label">Add the extra to</legend>
            {lots.map((l) => (
              <label
                key={l.id}
                className="flex cursor-pointer items-start gap-2 rounded-xl border border-stone-200 p-2.5 text-sm has-[:checked]:border-brand-500"
              >
                <input type="radio" name="pick" checked={into === l.id} onChange={() => setInto(l.id)} className="mt-1" />
                <span>
                  <span className="font-medium">Lot {l.code}</span> · {l.locationName}
                  <span className="block text-xs text-stone-500">
                    received {l.received}
                    {l.expires ? ` · expires ${l.expires}` : ""} · {fmt(l.qty)} {baseUnit} now
                  </span>
                </span>
              </label>
            ))}
            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-stone-200 p-2.5 text-sm has-[:checked]:border-brand-500">
              <input
                type="radio"
                name="pick"
                checked={into === "new"}
                onChange={() => setInto("new")}
                className="mt-1"
                data-testid="pick-new-lot"
              />
              <span className="flex-1">
                <span className="font-medium">A new lot</span>
                <span className="block text-xs text-stone-500">
                  Dated today, at the latest delivery&apos;s cost, expiring after the item&apos;s shelf life
                </span>
                {into === "new" && !scopeLocation && (
                  <select
                    value={newLoc}
                    onChange={(e) => setNewLoc(e.target.value)}
                    className="input mt-2"
                    aria-label="Location for the new lot"
                  >
                    {locations.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
              </span>
            </label>
          </fieldset>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn" onClick={reset} data-testid="count-deny">
              Deny
            </button>
            <button type="button" className="btn btn-primary" onClick={go} data-testid="count-allow">
              Allow
            </button>
          </div>
        </Modal>
      )}
    </form>
  );
}

/** Move all or part of a product to another location, oldest lots first */
export function MoveStock({
  productId,
  name,
  baseUnit,
  units,
  from,
  locations,
  back,
  action,
  label = "Move",
}: {
  productId: string;
  name: string;
  baseUnit: string;
  units: Unit[];
  from: Place[];
  locations: Place[];
  back: string;
  action: (fd: FormData) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [src, setSrc] = useState(from[0]?.id ?? "");
  const have = from.find((f) => f.id === src)?.qty ?? 0;
  const [unitId, setUnitId] = useState(units[0]?.id ?? "");
  const [qty, setQty] = useState(String(have));
  const others = locations.filter((l) => l.id !== src);
  const [dest, setDest] = useState(others[0]?.id ?? "");

  useEffect(() => {
    const f = units.find((u) => u.id === unitId)?.factor ?? 1;
    setQty(String(Math.round((have / f) * 1000) / 1000));
    if (dest === src || !dest) setDest(locations.find((l) => l.id !== src)?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, unitId]);

  if (!from.length) return null;
  return (
    <>
      <button type="button" className="btn btn-sm" onClick={() => setOpen(true)} data-testid="move-stock">
        {label}
      </button>
      {open && (
        <Modal label={`Move ${name}`} onClose={() => setOpen(false)} testId="move-dialog">
          <form action={action} className="space-y-3">
            <h3 className="text-lg font-semibold text-stone-900">Move {name}</h3>
            <input type="hidden" name="product_id" value={productId} />
            <input type="hidden" name="back" value={back} />
            {from.length === 1 ? (
              <>
                <input type="hidden" name="from_location" value={src} />
                <p className="text-sm text-stone-600">
                  From <b>{from[0].name}</b> ({fmt(from[0].qty ?? 0)} {baseUnit})
                </p>
              </>
            ) : (
              <label className="block">
                <span className="label">From</span>
                <select name="from_location" value={src} onChange={(e) => setSrc(e.target.value)} className="input">
                  {from.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({fmt(f.qty ?? 0)} {baseUnit})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block">
              <span className="label">To</span>
              <select name="to_location" value={dest} onChange={(e) => setDest(e.target.value)} className="input" required>
                {others.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <span className="label">How much</span>
              <div className="flex gap-2">
                <input
                  name="qty"
                  type="number"
                  min="0"
                  step="any"
                  required
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className="input"
                  aria-label="Quantity to move"
                />
                {units.length > 1 ? (
                  <select
                    name="unit_id"
                    value={unitId}
                    onChange={(e) => setUnitId(e.target.value)}
                    className="input w-auto"
                    aria-label="Unit"
                  >
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input type="hidden" name="unit_id" value={unitId} />
                )}
              </div>
              <p className="mt-1 text-xs text-stone-500">
                All of it is filled in. Oldest stock moves first; moving part of a lot splits it.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <SubmitButton className="btn btn-primary" pendingText="Moving…">
                Move
              </SubmitButton>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
