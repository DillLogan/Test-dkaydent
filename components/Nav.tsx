import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { can, ROLES, type Profile } from "@/lib/roles";
import { NavLinks } from "./NavLinks";

const GROUPS: { title: string; links: { href: string; label: string }[] }[] = [
  { title: "", links: [{ href: "/", label: "Dashboard" }] },
  {
    title: "Operations",
    links: [
      { href: "/purchasing", label: "Purchasing" },
      { href: "/receiving", label: "Receiving" },
      { href: "/inventory", label: "Inventory" },
      { href: "/floor-plan", label: "Location in shop" },
      { href: "/counter", label: "Counter sale" },
      { href: "/sales", label: "Sales orders" },
      { href: "/invoices", label: "Invoices" },
      { href: "/returns", label: "Returns & credits" },
      { href: "/payments", label: "Payments" },
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
  { title: "Account", links: [{ href: "/settings", label: "Settings" }] },
];

export function Nav({ profile }: { profile: Profile }) {
  const groups = can(profile)
    ? [...GROUPS, { title: "Admin", links: [{ href: "/admin/users", label: "Users & roles" }] }]
    : GROUPS;
  const roleLabel = ROLES.find((r) => r.value === profile.role)?.label;

  return (
    <aside className="border-b border-stone-200/80 bg-white md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col md:border-r md:border-b-0 print:hidden">
      <div className="flex items-center justify-between px-5 py-4 md:block md:py-6">
        <Link href="/" className="block px-1">
          <div className="font-display text-2xl leading-none text-stone-900">DKaydent</div>
          <div className="mt-1 text-sm text-brand-700">Wholesale flowers &amp; goods</div>
        </Link>
        <form action={signOut} className="md:hidden">
          <button className="text-xs text-stone-500 hover:underline">Sign out</button>
        </form>
      </div>

      <NavLinks groups={groups} />

      <div className="hidden border-t border-stone-200/80 px-5 py-4 md:block">
        <div className="truncate text-sm font-medium">{profile.full_name || profile.email}</div>
        <div className="text-xs text-stone-500">{roleLabel}</div>
        <form action={signOut} className="mt-2">
          <button className="text-xs text-stone-500 hover:underline">Sign out</button>
        </form>
      </div>
    </aside>
  );
}
