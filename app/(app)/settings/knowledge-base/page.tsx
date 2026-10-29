import Link from "next/link";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/roles";
import { loadKb, tutorialDocs } from "@/lib/kb";
import { KnowledgeBase } from "@/components/KnowledgeBase";
import { PageHeader } from "@/components/ui";
import { deleteArticle, restoreBuiltin, saveArticle, setArticleHidden } from "./actions";

export default async function KnowledgeBasePage() {
  const { supabase, profile } = await getSession();
  const { articles, categories } = await loadKb(supabase);
  return (
    <>
      <PageHeader title="Knowledge base" subtitle="How things work and why. Search it, or add what your team knows." back={{ href: "/settings", label: "Settings" }}>
        <Link href="/settings/tutorials" className="btn">
          Tutorials
        </Link>
      </PageHeader>
      <KnowledgeBase
        articles={articles}
        categories={categories}
        tutorials={tutorialDocs()}
        me={{ id: profile.id, isAdmin: can(profile) }}
        actions={{ saveArticle, deleteArticle, setArticleHidden, restoreBuiltin }}
      />
    </>
  );
}
