import { signOut } from "@/app/login/actions";
import { can, ROLES, type Profile } from "@/lib/roles";
import { NavShell, type NavGroup } from "./NavLinks";
import { createClient } from "@/lib/supabase/server";

const GROUPS: NavGroup[] = [
  { title: "", links: [{ href: "/", label: "Dashboard" }] },
  { title: "", links: [{ href: "/messages", label: "Messages" }] },
  {
    title: "Buying",
    links: [
      { href: "/purchasing", label: "Purchasing" },
      { href: "/receiving", label: "Receiving" },
      { href: "/vendors", label: "Vendors" },
    ],
  },
  {
    title: "Stock",
    links: [
      { href: "/inventory", label: "Inventory" },
      { href: "/floor-plan", label: "Location in shop" },
      { href: "/products", label: "Products" },
      { href: "/inventory/locations", label: "Locations" },
      { href: "/scan", label: "Scan" },
    ],
  },
  {
    title: "Selling",
    links: [
      { href: "/counter", label: "Counter sale" },
      { href: "/sales", label: "Sales orders" },
      { href: "/customers", label: "Customers" },
      { href: "/invoices", label: "Invoices" },
      { href: "/returns", label: "Returns & credits" },
      { href: "/payments", label: "Payments" },
      { href: "/routing", label: "Routing" },
    ],
  },
  {
    title: "Reports & data",
    links: [
      { href: "/reports", label: "Reports" },
      { href: "/import", label: "Import data" },
    ],
  },
];

export async function Nav({ profile }: { profile: Profile }) {
  let unread = 0;
  try {
    const supabase = await createClient();
    const { data } = await supabase.rpc("chat_unread");
    unread = (data ?? []).reduce((n: number, r: { unread: number }) => n + Number(r.unread), 0);
  } catch {
    /* the badge is optional */
  }
  const settings: NavGroup = can(profile)
    ? {
        title: "Settings",
        links: [
          { href: "/settings", label: "Settings" },
          { href: "/admin/users", label: "Users & roles" },
          { href: "/settings/web-store", label: "Web store" },
          { href: "/settings/tutorials", label: "Tutorials" },
          { href: "/settings/knowledge-base", label: "Knowledge base" },
          { href: "/settings/routing", label: "Maps & routing" },
        ],
      }
    : {
        title: "Settings",
        links: [
          { href: "/settings", label: "Settings" },
          { href: "/settings/tutorials", label: "Tutorials" },
          { href: "/settings/knowledge-base", label: "Knowledge base" },
        ],
      };
  return (
    <NavShell
      groups={[...GROUPS, settings].map((g) => ({ ...g, links: g.links.map((l) => (l.href === "/messages" && unread ? { ...l, label: `Messages (${unread})` } : l)) }))}
      userName={profile.full_name || profile.email || ""}
      roleLabel={ROLES.find((r) => r.value === profile.role)?.label ?? ""}
      signOut={signOut}
    />
  );
}
