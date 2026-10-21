"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { dbMessage, fail, num, str } from "@/lib/forms";
import { finalize, loadRequest } from "@/lib/payments";
import { getProvider, simulatedApproval } from "@/lib/valor/provider";

const safe = (p: string) => (p.startsWith("/") && !p.startsWith("//") ? p : "/payments");
const withParam = (path: string, key: string, value: string) => {
  const u = new URL(path, "http://x");
  u.searchParams.delete("error");
  u.searchParams.delete("message");
  u.searchParams.delete("charge");
  u.searchParams.set(key, value);
  return u.pathname + u.search;
};
const msg = (path: string, m: string) => withParam(path, "message", m);

function refreshAll() {
  revalidatePath("/payments");
  revalidatePath("/invoices");
  revalidatePath("/sales");
  revalidatePath("/counter");
}

// --------------------------------------------------------------- by hand

export async function recordPayment(soId: string, back: string, fd: FormData) {
  const { supabase } = await requireRole("sales");
  back = safe(back);
  const method = str(fd, "method") ?? "cash";
  const amount = num(fd, "amount");
  if (!amount || amount <= 0) fail(back, "Enter an amount.");
  const { error } = await supabase.rpc("record_payment", {
    p_so_id: soId,
    p_method: method,
    p_amount: amount,
    p_reference: str(fd, "reference"),
    p_tip: 0,
    p_details: { card_last4: str(fd, "card_last4"), notes: str(fd, "notes") },
  });
  if (error) fail(back, dbMessage(error));
  refreshAll();
  redirect(msg(back, `Recorded ${method} payment of $${amount.toFixed(2)}.`));
}

export async function voidPayment(paymentId: string, back: string) {
  const { supabase } = await requireRole("sales");
  back = safe(back);
  const { error } = await supabase.rpc("void_payment", { p_payment_id: paymentId });
  if (error) fail(back, dbMessage(error));
  refreshAll();
  redirect(msg(back, "Payment voided in the app. If it was a card payment, also void or refund it on the terminal or in the Valor portal."));
}

// --------------------------------------------------------------- terminal

async function sendToTerminal(supabase: any, requestId: string) {
  const r = await loadRequest(supabase, requestId);
  if (!r) throw new Error("Terminal request not found");
  const provider = getProvider();
  try {
    const res = await provider.startSale(r.payment_terminals, {
      reqTxnId: r.req_txn_id,
      amount: Number(r.amount),
      tipEntry: r.tip_entry,
      invoiceRef: r.invoice_ref ?? "",
    });
    if (res.status === "pending") {
      if (res.providerRef) await supabase.from("terminal_requests").update({ provider_ref: res.providerRef }).eq("id", requestId);
    } else {
      await finalize(supabase, requestId, res);
    }
  } catch (e: any) {
    await finalize(supabase, requestId, { status: "error", message: `Couldn't reach the terminal: ${String(e?.message ?? e).slice(0, 240)}` });
  }
}

/** Send an amount to a terminal for an order (deposit) or its invoice. */
export async function startTerminalCharge(soId: string, purpose: "invoice" | "deposit", back: string, fd: FormData) {
  const { supabase } = await requireRole("sales");
  back = safe(back);
  const terminal = str(fd, "terminal_id");
  const amount = num(fd, "amount");
  if (!terminal) fail(back, "Choose a terminal.");
  if (!amount || amount <= 0) fail(back, "Enter an amount.");
  const { data: id, error } = await supabase.rpc("create_terminal_request", {
    p_terminal_id: terminal,
    p_purpose: purpose,
    p_so_id: soId,
    p_amount: amount,
    p_provider: getProvider().name,
    p_tip_entry: fd.get("tip_entry") === "on",
    p_tax_rate: 0,
  });
  if (error) fail(back, dbMessage(error));
  await sendToTerminal(supabase, id as string);
  redirect(withParam(back, "charge", id as string));
}

/** The simulated terminal's buttons. */
export async function simulateTerminal(requestId: string, outcome: "approved" | "declined" | "timeout", back: string) {
  const { supabase } = await requireRole("sales");
  back = safe(back);
  const r = await loadRequest(supabase, requestId);
  if (!r) fail(back, "Terminal request not found.");
  if (r.provider !== "simulator") fail(back, "This terminal is live; use the device.");
  const tip = r.tip_entry && outcome === "approved" ? Math.round(Number(r.amount) * 0.1 * 100) / 100 : 0;
  try {
    await finalize(
      supabase,
      requestId,
      outcome === "approved"
        ? simulatedApproval(Number(r.amount), tip)
        : outcome === "declined"
          ? { status: "declined", message: "Declined (simulated)" }
          : { status: "timeout", message: "No card presented (simulated)" },
    );
  } catch (e: any) {
    fail(withParam(back, "charge", requestId), String(e.message ?? e));
  }
  refreshAll();
  redirect(withParam(back, "charge", requestId));
}

export async function cancelTerminalCharge(requestId: string, back: string) {
  const { supabase } = await requireRole("sales");
  back = safe(back);
  const r = await loadRequest(supabase, requestId);
  if (r?.status === "pending") {
    await getProvider()
      .cancel(r.payment_terminals, { reqTxnId: r.req_txn_id, amount: Number(r.amount), tipEntry: r.tip_entry, invoiceRef: r.invoice_ref ?? "", providerRef: r.provider_ref })
      .catch(() => {});
    await finalize(supabase, requestId, { status: "cancelled", message: "Cancelled from the app" });
  }
  refreshAll();
  redirect(withParam(back, "charge", requestId));
}

// --------------------------------------------------------------- counter

type CartLine = { product_id: string; unit_id: string; qty: number; unit_price: number };

export async function counterCheckout(fd: FormData) {
  const { supabase } = await requireRole("sales");
  let cart: CartLine[] = [];
  try {
    cart = JSON.parse(String(fd.get("cart") ?? "[]"));
  } catch {
    fail("/counter", "The cart couldn't be read. Try again.");
  }
  cart = cart.filter((l) => l && l.qty > 0);
  if (!cart.length) fail("/counter", "Add at least one item.");
  const method = str(fd, "method") ?? "cash";
  const tax = num(fd, "tax_rate") ?? 0;
  const customer = str(fd, "customer_id");

  const { data: soId, error } = await supabase.rpc("create_counter_sale", { p_customer_id: customer, p_lines: cart });
  if (error) fail("/counter", dbMessage(error));

  if (method === "terminal") {
    const terminal = str(fd, "terminal_id");
    const subtotal = cart.reduce((t, l) => t + l.qty * l.unit_price, 0);
    const total = Math.round(Math.round(subtotal * 100) / 100 * (1 + tax / 100) * 100) / 100;
    const { data: reqId, error: e2 } = await supabase.rpc("create_terminal_request", {
      p_terminal_id: terminal,
      p_purpose: "counter",
      p_so_id: soId,
      p_amount: total,
      p_provider: getProvider().name,
      p_tip_entry: fd.get("tip_entry") === "on",
      p_tax_rate: tax,
    });
    if (e2) fail(`/counter?sale=${soId}`, dbMessage(e2));
    await sendToTerminal(supabase, reqId as string);
    redirect(`/counter?sale=${soId}&charge=${reqId}`);
  }

  const { data: invId, error: e3 } = await supabase.rpc("complete_counter_sale", {
    p_so_id: soId,
    p_tax_rate: tax,
    p_payment: { method, reference: str(fd, "reference") },
  });
  if (e3) fail(`/counter?sale=${soId}`, dbMessage(e3));
  refreshAll();
  revalidatePath("/inventory");
  const tendered = num(fd, "tendered");
  const { data: inv } = await supabase.from("invoices").select("total").eq("id", invId).single();
  const change = method === "cash" && tendered && inv ? tendered - Number(inv.total) : null;
  redirect(
    `/counter?done=${invId}${change !== null && change > 0.004 ? `&change=${change.toFixed(2)}` : ""}`,
  );
}

/** After a declined/timed-out terminal charge: take another kind of payment, or try again. */
export async function counterRetry(soId: string, fd: FormData) {
  const { supabase } = await requireRole("sales");
  const method = str(fd, "method") ?? "cash";
  const back = `/counter?sale=${soId}`;
  const tax = num(fd, "tax_rate") ?? 0;
  if (method === "terminal") {
    const { data: lines } = await supabase.from("sales_order_lines").select("qty, unit_price").eq("so_id", soId);
    const subtotal = Math.round((lines ?? []).reduce((t, l) => t + Number(l.qty) * Number(l.unit_price), 0) * 100) / 100;
    const { data: paid } = await supabase.rpc("so_paid", { p_so_id: soId });
    const due = Math.round((subtotal * (1 + tax / 100) - Number(paid ?? 0)) * 100) / 100;
    const { data: reqId, error } = await supabase.rpc("create_terminal_request", {
      p_terminal_id: str(fd, "terminal_id"),
      p_purpose: "counter",
      p_so_id: soId,
      p_amount: due,
      p_provider: getProvider().name,
      p_tip_entry: fd.get("tip_entry") === "on",
      p_tax_rate: tax,
    });
    if (error) fail(back, dbMessage(error));
    await sendToTerminal(supabase, reqId as string);
    redirect(`/counter?sale=${soId}&charge=${reqId}`);
  }
  const { data: invId, error } = await supabase.rpc("complete_counter_sale", {
    p_so_id: soId,
    p_tax_rate: tax,
    p_payment: { method, reference: str(fd, "reference") },
  });
  if (error) fail(back, dbMessage(error));
  refreshAll();
  redirect(`/counter?done=${invId}`);
}

export async function counterCancel(soId: string) {
  const { supabase } = await requireRole("sales");
  const { data: paid } = await supabase.rpc("so_paid", { p_so_id: soId });
  if (Number(paid ?? 0) > 0) fail(`/counter?sale=${soId}`, "This sale has a payment. Open the order to sort it out.");
  const { error } = await supabase.from("sales_orders").update({ status: "cancelled" }).eq("id", soId).eq("status", "confirmed");
  if (error) fail(`/counter?sale=${soId}`, dbMessage(error));
  refreshAll();
  redirect(`/counter?message=${encodeURIComponent("Sale cancelled. Nothing was charged and no stock was taken.")}`);
}

// --------------------------------------------------------------- terminals (admin)

export async function saveTerminal(id: string | null, fd: FormData) {
  const { supabase } = await requireRole();
  const back = "/payments/terminals";
  const row = {
    name: str(fd, "name"),
    model: str(fd, "model") ?? "VP800",
    epi: str(fd, "epi"),
    serial_no: str(fd, "serial_no"),
    connection: str(fd, "connection") ?? "cloud",
    lan_host: str(fd, "lan_host"),
  };
  if (!row.name || !row.epi) fail(back, "Enter a name and the terminal's EPI.");
  const { error } = id
    ? await supabase.from("payment_terminals").update(row).eq("id", id)
    : await supabase.from("payment_terminals").insert(row);
  if (error) fail(back, error.code === "23505" ? "A terminal with that EPI already exists." : dbMessage(error));
  revalidatePath(back);
  redirect(msg(back, id ? "Terminal saved." : "Terminal added."));
}

export async function setTerminalActive(id: string, active: boolean) {
  const { supabase } = await requireRole();
  const { error } = await supabase.from("payment_terminals").update({ active }).eq("id", id);
  if (error) fail("/payments/terminals", dbMessage(error));
  revalidatePath("/payments/terminals");
  redirect("/payments/terminals");
}

// --------------------------------------------------------------- sync from terminal

export async function importTerminalSales(fd: FormData) {
  const { supabase } = await requireRole("sales");
  const back = "/payments/import";
  let payload: { tax_rate?: number; txns: any[]; maps: { item_key: string; product_id: string; unit_id: string }[] };
  try {
    payload = JSON.parse(String(fd.get("payload") ?? "{}"));
  } catch {
    fail(back, "The file couldn't be read. Choose it again.");
  }
  if (!payload.txns?.length) fail(back, "Nothing to sync.");
  if (payload.maps?.length) {
    const { error } = await supabase.from("terminal_item_map").upsert(payload.maps, { onConflict: "item_key" });
    if (error) fail(back, dbMessage(error));
  }
  let payments = 0,
    sales = 0,
    dupes = 0;
  const errors: string[] = [];
  for (const t of payload.txns) {
    const { data, error } = await supabase.rpc("import_terminal_txn", { p_txn: { ...t, tax_rate: payload.tax_rate ?? 0 } });
    if (error) errors.push(`${t.txn_id}: ${dbMessage(error)}`);
    else if (data?.result === "payment") payments++;
    else if (data?.result === "sale") sales++;
    else dupes++;
  }
  refreshAll();
  revalidatePath("/inventory");
  const parts = [
    payments && `${payments} payment${payments === 1 ? "" : "s"} applied`,
    sales && `${sales} sale${sales === 1 ? "" : "s"} added`,
    dupes && `${dupes} already synced`,
  ].filter(Boolean);
  const text = `${parts.join(", ") || "Nothing synced"}.${errors.length ? ` ${errors.length} failed: ${errors.slice(0, 3).join("; ")}` : ""}`;
  redirect(`/payments?${errors.length ? "error" : "message"}=${encodeURIComponent(text)}`);
}
