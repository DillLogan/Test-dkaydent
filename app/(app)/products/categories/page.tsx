import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import type { CategoryRule } from "@/lib/categorize";
import { addRule, applyToUncategorized, deleteRule } from "./actions";
import { CategoryTester } from "@/components/CategoryTester";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorBanner, Notice, PageHeader, Section } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export default async function CategoryRulesPage({ searchParams }: { searchParams: SP }) {
  const { error, message } = await searchParams;
  const { supabase, profile } = await getSession();
  const [{ data: rules }, { count: uncategorized }] = await Promise.all([
    supabase.from("category_rules").select("*").order("category").order("keyword"),
    supabase.from("products").select("id", { count: "exact", head: true }).is("category", null),
  ]);
  const canEdit = can(profile, "buyer");
  const grouped = new Map<string, any[]>();
  for (const r of rules ?? []) grouped.set(r.category, [...(grouped.get(r.category) ?? []), r]);

  return (
    <>
      <PageHeader
        title="Category rules"
        subtitle="How imports sort items into categories: if a keyword starts a word in the item name, the item goes in that category. The longest matching keyword wins."
        back={{ href: "/products", label: "Products" }}
      >
        {canEdit && (uncategorized ?? 0) > 0 && (
          <form action={applyToUncategorized}>
            <SubmitButton className="btn" pendingText="Sorting…">
              Sort {uncategorized} uncategorized item{uncategorized === 1 ? "" : "s"}
            </SubmitButton>
          </form>
        )}
      </PageHeader>
      <ErrorBanner error={error} />
      <Notice message={message} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Section title={`${rules?.length ?? 0} rules`}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Keywords</th>
                </tr>
              </thead>
              <tbody>
                {[...grouped.entries()].map(([cat, rs]) => (
                  <tr key={cat}>
                    <td className="font-medium whitespace-nowrap">
                      {cat}
                      <div className="text-xs font-normal text-stone-500">
                        {rs[0].kind === "hard_good" ? "Hard good" : rs[0].kind === "flower" ? "Flower" : "Either"}
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {rs.map((r) => (
                          <span key={r.id} className="inline-flex items-center gap-1 rounded-full border border-stone-200 py-0.5 pr-1 pl-2.5 text-xs">
                            {r.keyword}
                            {canEdit && (
                              <form action={deleteRule.bind(null, r.id)}>
                                <button className="rounded-full px-1 text-stone-400 hover:bg-red-50 hover:text-red-700" aria-label={`Remove keyword ${r.keyword}`}>
                                  ×
                                </button>
                              </form>
                            )}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
        <div className="space-y-4">
          <CategoryTester rules={(rules ?? []) as CategoryRule[]} />
          {canEdit && (
            <form action={addRule} className="card space-y-3">
              <h3 className="font-semibold">Add a rule</h3>
              <label className="block">
                <span className="label">Keyword</span>
                <input name="keyword" className="input" placeholder="sweet pea" required />
              </label>
              <label className="block">
                <span className="label">Category</span>
                <input name="category" className="input" list="cats" placeholder="Sweet Peas" required />
                <datalist id="cats">
                  {[...grouped.keys()].map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
              <label className="block">
                <span className="label">Type</span>
                <select name="kind" className="input" defaultValue="flower">
                  <option value="flower">Flower / greens</option>
                  <option value="hard_good">Hard good</option>
                  <option value="">Either</option>
                </select>
              </label>
              <SubmitButton>Add rule</SubmitButton>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
