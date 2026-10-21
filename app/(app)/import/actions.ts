"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { dbMessage, fail } from "@/lib/forms";
import { IMPORT_ROLE, validate, type Entity } from "@/lib/importSpec";

async function loadKeys(supabase: any, entity: Entity) {
  if (entity === "products") {
    const { data } = await supabase.from("products").select("id, sku, base_unit");
    return new Map<string, any>((data ?? []).map((p: any) => [p.sku.toUpperCase(), p]));
  }
  const { data } = await supabase.from(entity).select("id, name");
  return new Map<string, any>((data ?? []).map((r: any) => [r.name.trim().toLowerCase(), r]));
}

export async function importRows(entity: Entity, fd: FormData) {
  const { supabase } = await requireRole(IMPORT_ROLE[entity]);
  const path = `/import?entity=${entity}`;

  let raw: Record<string, string>[] = [];
  try {
    raw = JSON.parse(String(fd.get("rows") ?? "[]"));
  } catch {
    raw = [];
  }
  if (!Array.isArray(raw) || raw.length === 0) fail(path, "The file had no rows.");

  const existing = await loadKeys(supabase, entity);
  const { data: tierRows } = await supabase.from("price_tiers").select("id, name");
  const tiers = Object.fromEntries((tierRows ?? []).map((t) => [t.name.trim().toLowerCase(), t.id]));
  const results = validate(entity, raw, new Set(existing.keys()), tiers);
  const bad = results.filter((r) => r.errors.length);
  if (bad.length) fail(path, `${bad.length} rows have errors (first: row ${bad[0].row}: ${bad[0].errors[0]}). Nothing was imported.`);

  let created = 0;
  let updated = 0;

  if (entity === "products") {
    const creates = results.filter((r) => r.action === "create").map((r) => r.record);
    const updates = results.filter((r) => r.action === "update").map((r) => r.record);

    if (creates.length) {
      const { data, error } = await supabase
        .from("products")
        .insert(creates.map(({ units, ...p }) => p))
        .select("id, sku");
      if (error) fail(path, dbMessage(error));
      const idBySku = new Map((data ?? []).map((p) => [p.sku, p.id]));
      const unitRows = creates.flatMap((p) =>
        p.units.filter((u: any) => u.name !== p.base_unit).map((u: any) => ({ product_id: idBySku.get(p.sku), name: u.name, factor: u.factor })),
      );
      if (unitRows.length) {
        const { error: uerr } = await supabase.from("product_units").insert(unitRows);
        if (uerr) fail(path, dbMessage(uerr));
      }
      created = creates.length;
    }

    if (updates.length) {
      const { data: allUnits } = await supabase.from("product_units").select("product_id, name");
      const have = new Set((allUnits ?? []).map((u) => `${u.product_id}:${u.name}`));
      const newUnits: any[] = [];
      for (const { units, base_unit, ...p } of updates) {
        const cur = existing.get(p.sku);
        const { error } = await supabase.from("products").update(p).eq("id", cur.id);
        if (error) fail(path, `${p.sku}: ${dbMessage(error)}`);
        for (const u of units) if (!have.has(`${cur.id}:${u.name}`)) newUnits.push({ product_id: cur.id, name: u.name, factor: u.factor });
      }
      if (newUnits.length) {
        const { error } = await supabase.from("product_units").insert(newUnits);
        if (error) fail(path, dbMessage(error));
      }
      updated = updates.length;
    }
  } else {
    const creates = results.filter((r) => r.action === "create").map((r) => r.record);
    const updates = results.filter((r) => r.action === "update").map((r) => r.record);
    if (creates.length) {
      const { error } = await supabase.from(entity).insert(creates);
      if (error) fail(path, dbMessage(error));
      created = creates.length;
    }
    for (const rec of updates) {
      const cur = existing.get(rec.name.trim().toLowerCase());
      const { error } = await supabase.from(entity).update(rec).eq("id", cur.id);
      if (error) fail(path, `${rec.name}: ${dbMessage(error)}`);
      updated++;
    }
  }

  revalidatePath(`/${entity}`);
  redirect(`${path}&message=${encodeURIComponent(`Imported ${created} new and updated ${updated} ${entity}.`)}`);
}
