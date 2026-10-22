"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { dbMessage, fail } from "@/lib/forms";
import { IMPORT_ROLE, validate, type Entity } from "@/lib/importSpec";
import { validateStockRows } from "@/lib/stockBatch";
import { categorize, type CategoryRule } from "@/lib/categorize";
import { can } from "@/lib/roles";

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
    // Blank categories are filled from the keyword rules
    const { data: rules } = await supabase.from("category_rules").select("keyword, category, kind, priority");
    for (const r of results) if (!r.record.category) r.record.category = categorize(r.record.name ?? "", (rules ?? []) as CategoryRule[])?.category ?? null;
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

/** CSV stock batch: validate again on the server, then receive everything in one transaction. */
export async function importStockBatch(fd: FormData) {
  const { supabase, profile } = await requireRole("buyer", "warehouse");
  const path = "/import?entity=stock";
  let raw: Record<string, string>[] = [];
  try {
    raw = JSON.parse(String(fd.get("rows") ?? "[]"));
  } catch {
    raw = [];
  }
  if (!Array.isArray(raw) || raw.length === 0) fail(path, "The file had no rows.");

  const [{ data: products }, { data: units }, { data: locations }, { data: rules }] = await Promise.all([
    supabase.from("products").select("id, sku, name, base_unit, category"),
    supabase.from("product_units").select("product_id, name"),
    supabase.from("locations").select("name").eq("active", true),
    supabase.from("category_rules").select("keyword, category, kind, priority"),
  ]);
  const unitsBy = new Map<string, string[]>();
  for (const u of units ?? []) unitsBy.set(u.product_id, [...(unitsBy.get(u.product_id) ?? []), u.name]);
  const results = validateStockRows(raw, {
    items: (products ?? []).map((p) => ({ sku: p.sku, name: p.name, baseUnit: p.base_unit, category: p.category, units: unitsBy.get(p.id) ?? [p.base_unit] })),
    locations: (locations ?? []).map((l) => l.name),
    rules: (rules ?? []) as CategoryRule[],
    defaultLocation: String(fd.get("default_location") ?? ""),
    canCreate: can(profile, "buyer"),
  });
  const bad = results.filter((r) => r.errors.length);
  if (bad.length) fail(path, `${bad.length} rows have errors (first: row ${bad[0].row}: ${bad[0].errors[0]}). Nothing was received.`);

  const { data, error } = await supabase.rpc("import_stock_batch", {
    p_rows: results.map((r) => r.payload),
    p_reference: String(fd.get("reference") ?? "").trim() || null,
  });
  if (error) fail(path, dbMessage(error));
  revalidatePath("/inventory");
  revalidatePath("/products");
  const r = data as { reference: string; items_created: number; lots_created: number; value: number };
  redirect(
    `${path}&message=${encodeURIComponent(
      `Received ${r.lots_created} lots ($${Number(r.value).toFixed(2)} at cost) under ${r.reference}${r.items_created ? `, and created ${r.items_created} new items` : ""}.`,
    )}`,
  );
}
