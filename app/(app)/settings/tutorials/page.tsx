import Link from "next/link";
import { getSession } from "@/lib/auth";
import { TUTORIALS } from "@/lib/help";
import { PageHeader } from "@/components/ui";

export default async function TutorialsPage() {
  await getSession();
  return (
    <>
      <PageHeader title="Tutorials" subtitle="Step-by-step guides for the main jobs" back={{ href: "/settings", label: "Settings" }}>
        <Link href="/settings/knowledge-base" className="btn print:hidden">
          Knowledge base
        </Link>
      </PageHeader>

      <nav aria-label="Tutorials" className="mb-6 flex flex-wrap gap-2 print:hidden">
        {TUTORIALS.map((t) => (
          <a key={t.id} href={`#${t.id}`} className="rounded-full border border-stone-200 bg-white px-3 py-1 text-sm hover:bg-stone-50">
            {t.title.replace(/ \(.*\)/, "")}
          </a>
        ))}
      </nav>

      <div className="space-y-8">
        {TUTORIALS.map((t) => (
          <article key={t.id} id={t.id} className="card scroll-mt-20" data-tutorial={t.id}>
            <h2 className="text-xl font-semibold">{t.title}</h2>
            <p className="mt-1 text-sm text-stone-600">{t.summary}</p>
            <p className="mt-1 text-xs text-stone-500">For: {t.who}</p>
            <ol className="mt-4 space-y-3">
              {t.steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">{i + 1}</span>
                  <div className="text-sm">
                    {s.text}
                    {s.href && (
                      <>
                        {" "}
                        <Link href={s.href} className="link whitespace-nowrap">
                          {s.linkLabel ?? "Open"} →
                        </Link>
                      </>
                    )}
                    {!t.noImages && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/help/${t.id}-${i + 1}.jpg`} alt={`Screenshot for step ${i + 1}: the highlighted box and arrow show what to use`} loading="lazy" className="mt-2 w-full max-w-2xl rounded-lg border border-stone-200" />
                    )}
                  </div>
                </li>
              ))}
            </ol>
            {t.tip && <p className="mt-4 rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-800">Tip: {t.tip}</p>}
          </article>
        ))}
      </div>
    </>
  );
}
