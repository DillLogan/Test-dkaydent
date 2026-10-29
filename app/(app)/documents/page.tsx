import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import Wordsmith from "@/components/documents/Wordsmith";
import { SignaturesView } from "@/components/documents/SignaturesView";

type SP = Promise<Record<string, string | undefined>>;

const TABS = [
  ["write", "Word editor"],
  ["sign", "Send for signing"],
  ["mine", "To sign"],
] as const;

/** Documents: a Word-style editor (private to each person), PDF signing sent from your account, and what's waiting for your signature. */
export default async function DocumentsPage({ searchParams }: { searchParams: SP }) {
  const { tab: tabParam } = await searchParams;
  // every staff role; customers can't reach this page (they sign from the emailed link)
  const { supabase, profile } = await requireRole("buyer", "warehouse", "sales", "orders_manager");
  const tab = TABS.some(([k]) => k === tabParam) ? tabParam! : "write";
  const { data: mine } =
    tab === "mine" && profile.email
      ? await supabase
          .from("signature_requests")
          .select("id, token, doc_name, status, sent_at, completed_at, sender_name, sender_email")
          .ilike("recipient_email", profile.email.replace(/[%_\\]/g, "\\$&"))
          .order("sent_at", { ascending: false })
      : { data: [] as { id: string; token: string; doc_name: string; status: string; sent_at: string; completed_at: string | null; sender_name: string | null; sender_email: string | null }[] };

  return (
    <>
      <PageHeader title="Documents" subtitle="Write in a Word-style editor, send PDFs for signing, and sign what's sent to you" />
      <nav className="mb-5 flex flex-wrap gap-1 rounded-full bg-stone-100 p-1 sm:w-fit" aria-label="Documents">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/documents?tab=${k}`} aria-current={tab === k ? "page" : undefined} className={`nav-link rounded-full px-4 py-1.5 text-sm ${tab === k ? "bg-white font-medium shadow-sm" : "text-stone-600 hover:text-stone-900"}`}>
            {l}
          </Link>
        ))}
      </nav>
      {tab === "write" && (
        <div className="dk-docs">
          <Wordsmith />
        </div>
      )}
      {tab === "sign" && <SignaturesView senderEmail={profile.email} />}
      {tab === "mine" && (
        <div className="space-y-3">
          <p className="text-sm text-stone-500">
            Documents sent to your account email{profile.email ? <> (<b>{profile.email}</b>)</> : null}. You sign them while signed in, so no extra check is needed.
          </p>
          {(mine ?? []).length === 0 ? (
            <div className="card text-sm text-stone-500">Nothing waiting for your signature.</div>
          ) : (
            <ul className="stagger space-y-2">
              {(mine ?? []).map((r) => (
                <li key={r.id} className="card flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-stone-900">{r.doc_name}</div>
                    <div className="text-xs text-stone-500">
                      From {r.sender_name || r.sender_email || "DKaydent"} · {new Date(r.sent_at).toLocaleDateString()}
                    </div>
                  </div>
                  {r.status === "completed" ? (
                    <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-800">Signed</span>
                  ) : (
                    <a href={`/sign/${r.token}`} className="btn btn-primary">
                      Open and sign
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
