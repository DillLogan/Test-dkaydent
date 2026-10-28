import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Nav } from "@/components/Nav";
import { getSession } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await getSession();
  if (profile.role === "customer") {
    // Convenience only: the database already hides everything but the shop from customer logins.
    const path = (await headers()).get("x-pathname") ?? "";
    if (!(path === "/shop" || path.startsWith("/shop/") || path === "/settings")) redirect("/shop");
  }
  return (
    <div className="min-h-screen md:flex">
      <Nav profile={profile} />
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8 print:p-0">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
