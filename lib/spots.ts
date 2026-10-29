/** Choices for "where inside a location": "Rack A (any shelf)", "Rack A · Shelf 2"…, as "sectionId::shelf" values. */
export function spotOptions(sections: { id: string; name: string; shelves: string[] | null }[]): { value: string; label: string }[] {
  return sections.flatMap((x) => [
    { value: `${x.id}::`, label: (x.shelves ?? []).length ? `${x.name} (any shelf)` : x.name },
    ...(x.shelves ?? []).map((sh) => ({ value: `${x.id}::${sh}`, label: `${x.name} · Shelf ${sh}` })),
  ]);
}

export function splitSpot(v: unknown): { sectionId: string | null; shelf: string | null } {
  const [sectionId, shelf] = String(v ?? "").split("::");
  return { sectionId: sectionId || null, shelf: shelf || null };
}

export const spotText = (section?: string | null, shelf?: string | null) => [section, shelf ? `Shelf ${shelf}` : ""].filter(Boolean).join(" · ");
