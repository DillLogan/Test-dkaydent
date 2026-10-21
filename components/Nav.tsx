import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { can, ROLES, type Profile } from "@/lib/roles";

const GROUPS: { title: string; links: { href: string; label: string }[] }[] = [
  { title: "", links: [{ href: "/", label: "Dashboard" }] },
  {
    title: "Operations",
    links: [
      { href: "/purchasing", label: "Purchasing" },
      { href: "/inventory", label: "Inventory" },
      { href: "/sales", label: "Sales orders" },
      { href: "/invoices", label: "Invoices" },
      { href: "/returns", label: "Returns & credits" },
      { href: "/scan", label: "Scan" },
    ],
  },
  {
    title: "Records",
    links: [
      { href: "/products", label: "Products" },
      { href: "/vendors", label: "Vendors" },
      { href: "/customers", label: "Customers" },
      { href: "/inventory/locations", label: "Locations" },
      { href: "/import", label: "Import data" },
    ],
  },
  { title: "Insights", links: [{ href: "/reports", label: "Reports" }] },
];

export function Nav({ profile }: { profile: Profile }) {
  const groups = can(profile)
    ? [...GROUPS, { title: "Admin", links: [{ href: "/admin/users", label: "Users & roles" }] }]
    : GROUPS;
  const roleLabel = ROLES.find((r) => r.value === profile.role)?.label;

  return (
    <aside className="border-b border-stone-200 bg-white md:sticky md:top-0 md:flex md:h-screen md:w-56 md:shrink-0 md:flex-col md:border-r md:border-b-0 print:hidden">
      <div className="flex items-center justify-between px-4 py-3 md:block md:py-5">
        <Link href="/" className="block">
          <div className="text-[10px] font-semibold tracking-widest text-brand-700 uppercase">DKaydent</div>
          <div className="text-base leading-tight font-semibold">Wholesale</div>
        </Link>
        <form action={signOut} className="md:hidden">
          <button className="text-xs text-stone-500 hover:underline">Sign out</button>
        </form>
      </div>

      <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:block md:flex-1 md:overflow-y-auto md:pb-4">
        {groups.map((g) => (
          <div key={g.title || "home"} className="contents md:mb-4 md:block">
            {g.title && (
              <div className="hidden px-2 pb-1 text-[10px] font-semibold tracking-widest text-stone-400 uppercase md:block">
                {g.title}
              </div>
            )}
            {g.links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="block shrink-0 rounded-md px-2 py-1.5 text-sm whitespace-nowrap text-stone-700 hover:bg-stone-100 hover:text-stone-900"
              >
                {l.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="hidden border-t border-stone-200 px-4 py-3 md:block">
        <div className="truncate text-sm font-medium">{profile.full_name || profile.email}</div>
        <div className="text-xs text-stone-500">{roleLabel}</div>
        <form action={signOut} className="mt-2">
          <button className="text-xs text-stone-500 hover:underline">Sign out</button>
        </form>
      </div>
    </aside>
  );
}
