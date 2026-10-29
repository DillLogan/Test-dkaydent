"use client";

import { useEffect, useRef, useState } from "react";
import SignatureEditor from "./SignatureEditor";

type Doc = { id: string; name: string; pageCount: number; status: string; createdAt: string; fields: number };
type Req = {
  id: string;
  doc_name: string;
  recipient_email: string;
  status: "sent" | "completed";
  opened: boolean;
  sent_at: string;
  completed_at: string | null;
  sender_name: string | null;
  sender_email: string | null;
  audit: { name?: string } | null;
};

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

/**
 * Documents to sign (ported from the BrightStar CRM handoff): upload a PDF, mark where people sign or type,
 * send it to an email, and track what came back signed. Sent from the signed-in account's email.
 */
export function SignaturesView({ senderEmail }: { senderEmail: string | null }) {
  const [tab, setTab] = useState<"docs" | "sent">("docs");
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [reqs, setReqs] = useState<Req[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<{ id: string; name: string } | null>(null);
  const [sendId, setSendId] = useState<string | null>(null);
  const [sendEmail, setSendEmail] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [sent, setSent] = useState<{ email: string; link: string; mailed: boolean; needsLogin: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    const [d, r] = await Promise.all([fetch("/api/signatures", { cache: "no-store" }), fetch("/api/signatures/requests", { cache: "no-store" })]);
    const dj = await d.json().catch(() => ({}));
    const rj = await r.json().catch(() => ({}));
    setDocs(dj.docs ?? []);
    setReqs(rj.requests ?? []);
    if (!d.ok) setErr(dj.error ?? "Couldn't load documents.");
  }
  useEffect(() => {
    load();
  }, []);

  async function onFile(f?: File | null) {
    if (!f) return;
    if (fileRef.current) fileRef.current.value = "";
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) return setErr("Choose a PDF.");
    if (f.size > 10 * 1024 * 1024) return setErr("That PDF is over 10 MB. Use a smaller or compressed PDF.");
    setErr("");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", f);
      fd.set("name", f.name.replace(/\.pdf$/i, ""));
      const r = await fetch("/api/signatures", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErr(j.error ?? "Upload failed.");
      else {
        await load();
        setOpen({ id: j.doc.id, name: j.doc.name }); // straight into the field editor
      }
    } catch {
      setErr("Upload failed.");
    }
    setBusy(false);
  }

  async function doSend(id: string) {
    if (!sendEmail.trim()) return setErr("Enter an email.");
    setSendBusy(true);
    setErr("");
    try {
      const r = await fetch(`/api/signatures/${id}/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: sendEmail.trim() }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErr(j.error ?? "Send failed.");
      else {
        setSent({ email: sendEmail.trim(), link: j.link, mailed: !!j.mailed, needsLogin: !!j.needsLogin });
        setSendEmail("");
        setSendId(null);
        load();
      }
    } catch {
      setErr("Send failed.");
    }
    setSendBusy(false);
  }

  async function delDoc(id: string) {
    if (!window.confirm("Delete this document and its field layout? Requests already sent keep working.")) return;
    await fetch(`/api/signatures/${id}`, { method: "DELETE" });
    load();
  }
  async function delReq(r: Req) {
    if (!window.confirm(r.status === "sent" ? "Withdraw this request? The signing link stops working." : "Remove this signed document and its copy?")) return;
    await fetch(`/api/signatures/requests/${r.id}`, { method: "DELETE" });
    load();
  }

  const unseen = (reqs ?? []).filter((r) => r.status === "completed" && !r.opened).length;

  return (
    <div className="space-y-4" data-testid="signatures">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-full bg-stone-100 p-1" role="tablist">
          {(
            [
              ["docs", "Documents"],
              ["sent", `Sent${unseen ? ` (${unseen} new)` : ""}`],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-full px-4 py-1.5 text-sm ${tab === k ? "bg-white font-medium shadow-sm" : "text-stone-600"}`}>
              {l}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <input ref={fileRef} type="file" accept="application/pdf" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? "Uploading…" : "+ Add PDF"}
        </button>
      </div>
      <p className="text-xs text-stone-500">
        Requests are sent from your account{senderEmail ? <> (<b>{senderEmail}</b>)</> : null}; replies go to you. Someone with a DKaydent login signs while signed in to that
        account; anyone else confirms their email on the link.
      </p>
      {err && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {err}
        </div>
      )}
      {sent && (
        <div className="pop-in space-y-2 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm" data-testid="sent-notice">
          <div>
            {sent.mailed ? (
              <>
                Emailed to <b>{sent.email}</b>.
              </>
            ) : (
              <>
                Request made for <b>{sent.email}</b>. Email isn&apos;t set up, so send them this link yourself.
              </>
            )}{" "}
            {sent.needsLogin ? "They have a DKaydent login, so they'll sign in to sign." : "They'll confirm their email to open it."}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input readOnly value={sent.link} className="input min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} aria-label="Signing link" />
            <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(sent.link)}>
              Copy link
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setSent(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      {tab === "docs" &&
        (docs === null ? (
          <div className="skeleton h-24" />
        ) : docs.length === 0 ? (
          <div className="card text-sm text-stone-500">No documents yet. Add a PDF, mark where people sign or type, then send it.</div>
        ) : (
          <ul className="stagger space-y-2">
            {docs.map((d) => (
              <li key={d.id} className="card space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-stone-900">{d.name}</div>
                    <div className="text-xs text-stone-500">
                      {d.fields ? `${d.fields} field${d.fields === 1 ? "" : "s"}` : "No fields yet"}
                      {d.pageCount ? ` · ${d.pageCount} page${d.pageCount === 1 ? "" : "s"}` : ""} · added {when(d.createdAt)}
                    </div>
                  </div>
                  <button type="button" className="btn btn-sm" onClick={() => setOpen({ id: d.id, name: d.name })}>
                    Mark fields
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={!d.fields}
                    title={d.fields ? "" : "Mark at least one field first"}
                    onClick={() => {
                      setSendId(sendId === d.id ? null : d.id);
                      setSendEmail("");
                      setErr("");
                    }}
                  >
                    Send to…
                  </button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => delDoc(d.id)}>
                    Delete
                  </button>
                </div>
                {sendId === d.id && (
                  <form
                    className="pop-in flex flex-wrap items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      doSend(d.id);
                    }}
                  >
                    <input value={sendEmail} onChange={(e) => setSendEmail(e.target.value)} placeholder="recipient@email.com" type="email" required className="input min-w-48 flex-1" autoFocus aria-label="Recipient email" />
                    <button type="submit" className="btn btn-primary" disabled={sendBusy}>
                      {sendBusy ? "Sending…" : "Send"}
                    </button>
                    <button type="button" className="btn" onClick={() => setSendId(null)}>
                      Cancel
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        ))}

      {tab === "sent" &&
        (reqs === null ? (
          <div className="skeleton h-24" />
        ) : reqs.length === 0 ? (
          <div className="card text-sm text-stone-500">Nothing sent yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Sent to</th>
                  <th>Sent by</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {reqs.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium">{r.doc_name}</td>
                    <td>{r.recipient_email}</td>
                    <td className="text-stone-500">{r.sender_name || r.sender_email || "—"}</td>
                    <td>
                      {r.status === "completed" ? (
                        <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-800">
                          Signed {when(r.completed_at)}
                          {!r.opened && " · new"}
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">Waiting · sent {when(r.sent_at)}</span>
                      )}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {r.status === "completed" && (
                        <a className="btn btn-sm" href={`/api/signatures/requests/${r.id}`} onClick={() => setTimeout(load, 1500)}>
                          Download
                        </a>
                      )}{" "}
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => delReq(r)}>
                        {r.status === "sent" ? "Withdraw" : "Remove"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {open && (
        <SignatureEditor
          key={open.id}
          docId={open.id}
          docName={open.name}
          onClose={() => {
            setOpen(null);
            load();
          }}
        />
      )}
    </div>
  );
}
