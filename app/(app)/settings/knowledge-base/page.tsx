import Link from "next/link";
import { getSession } from "@/lib/auth";
import { ARTICLES, KB_CATEGORIES } from "@/lib/help";
import { KnowledgeBase } from "@/components/KnowledgeBase";
import { PageHeader } from "@/components/ui";

export default async function KnowledgeBasePage() {
  await getSession();
  return (
    <>
      <PageHeader title="Knowledge base" subtitle="How things work and why" back={{ href: "/settings", label: "Settings" }}>
        <Link href="/settings/tutorials" className="btn">
          Tutorials
        </Link>
      </PageHeader>
      <KnowledgeBase articles={ARTICLES} categories={KB_CATEGORIES} />
    </>
  );
}
