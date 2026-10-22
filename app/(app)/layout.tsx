import { Nav } from "@/components/Nav";
import { getSession } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await getSession();
  return (
    <div className="min-h-screen md:flex">
      <Nav profile={profile} />
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8 print:p-0">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
