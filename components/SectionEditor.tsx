"use client";

import { useEffect, useRef, useState } from "react";

export type SectionDraft = { id?: string; locationId: string; newLocation?: string; name: string; shelves: string; place: boolean };

/**
 * Pop-up editor for a floor plan section (add or edit), or for renaming a location.
 * A section belongs to a location ("Rack A" in "Cooler 1") and lists its shelves ("1-4" or "Top, Middle, Bottom").
 */
export function SectionEditor(props: {
  mode: "new" | "edit" | "rename";
  locations: { id: string; name: string }[];
  initial: { id?: string; locationId?: string; name?: string; shelves?: string[] };
  error: string | null;
  pending: boolean;
  onSave: (d: SectionDraft) => void;
  onRename: (id: string, name: string) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const { mode, locations, initial } = props;
  const [loc, setLoc] = useState(initial.locationId || locations[0]?.id || "__new");
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="modal-bg fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="sec-title"
        data-testid={mode === "rename" ? "location-editor" : "section-editor"}
        className="w-full max-w-md space-y-3 rounded-2xl bg-white p-5 shadow-xl"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          if (mode === "rename") return props.onRename(initial.id!, String(fd.get("name") ?? ""));
          props.onSave({
            id: initial.id,
            locationId: loc,
            newLocation: String(fd.get("newLocation") ?? ""),
            name: String(fd.get("name") ?? ""),
            shelves: String(fd.get("shelves") ?? ""),
            place: fd.get("place") === "on",
          });
        }}
      >
        <h2 id="sec-title" className="text-lg font-semibold text-stone-900">
          {mode === "rename" ? "Rename location" : mode === "edit" ? "Edit section" : "Add section"}
        </h2>
        {props.error && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {props.error}
          </div>
        )}
        {mode === "rename" ? (
          <label className="block">
            <span className="label">Location name</span>
            <input ref={first} name="name" className="input" required maxLength={60} defaultValue={initial.name} />
          </label>
        ) : (
          <>
            <label className="block">
              <span className="label">Location</span>
              <select name="locationId" className="input" value={loc} onChange={(e) => setLoc(e.target.value)} data-testid="section-location">
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
                <option value="__new">+ New location…</option>
              </select>
            </label>
            {loc === "__new" && (
              <label className="block">
                <span className="label">New location name</span>
                <input name="newLocation" className="input" required maxLength={60} placeholder="e.g. Cooler 3" />
              </label>
            )}
            <label className="block">
              <span className="label">Section name</span>
              <input ref={first} name="name" className="input" required maxLength={40} placeholder="e.g. Rack A" defaultValue={initial.name} data-testid="section-name" />
            </label>
            <label className="block">
              <span className="label">Shelves</span>
              <input name="shelves" className="input" placeholder="1-4, or Top, Middle, Bottom" defaultValue={initial.shelves?.join(", ")} data-testid="section-shelves" />
              <span className="mt-1 block text-xs text-stone-500">Separate with commas. 1-4 makes shelves 1, 2, 3 and 4. Leave empty if it has none.</span>
            </label>
            {mode === "new" && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="place" defaultChecked /> Put it on the plan now
              </label>
            )}
          </>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          {mode === "edit" && props.onDelete ? (
            <button type="button" className="btn btn-danger" onClick={props.onDelete}>
              Delete section
            </button>
          ) : (
            <span />
          )}
          <span className="flex gap-2">
            <button type="button" className="btn" onClick={props.onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={props.pending} data-testid="section-save">
              {mode === "new" ? "Add section" : "Save"}
            </button>
          </span>
        </div>
      </form>
    </div>
  );
}
