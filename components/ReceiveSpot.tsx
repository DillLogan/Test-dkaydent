"use client";

import { useState } from "react";
import { spotOptions } from "@/lib/spots";

export type SpotSection = { id: string; location_id: string; name: string; shelves: string[] };
export type SpotHome = { location_id: string; section_id: string | null; shelf: string | null };

const key = (h?: SpotHome | null) => (h && h.section_id ? `${h.section_id}::${h.shelf ?? ""}` : "");

/** Location, then section and shelf inside it, for one line being received. The spot starts at the item's usual spot in that location. */
export function ReceiveSpot({
  lineId,
  name,
  locations,
  sections,
  homes,
  defaultLoc,
  defaultLabel,
}: {
  lineId: string;
  name: string;
  locations: { id: string; name: string }[];
  sections: SpotSection[];
  homes: SpotHome[];
  defaultLoc: string;
  /** when set, an empty location means "use the form's default location" */
  defaultLabel?: string;
}) {
  const homeIn = (loc: string) => homes.find((h) => h.location_id === loc);
  const [loc, setLoc] = useState(defaultLoc);
  const [spot, setSpot] = useState(key(homeIn(defaultLoc)));
  const here = sections.filter((s) => s.location_id === loc);
  return (
    <div className="flex flex-wrap gap-1.5">
      <select
        name={`loc_${lineId}`}
        className="input w-auto"
        value={loc}
        onChange={(e) => {
          setLoc(e.target.value);
          setSpot(key(homeIn(e.target.value)));
        }}
        aria-label={`Location for ${name}`}
      >
        {defaultLabel !== undefined && <option value="">{defaultLabel}</option>}
        {locations.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
      {here.length > 0 && (
        <select name={`spot_${lineId}`} className="input w-auto" value={spot} onChange={(e) => setSpot(e.target.value)} aria-label={`Section and shelf for ${name}`}>
          <option value="">No section</option>
          {spotOptions(here).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

