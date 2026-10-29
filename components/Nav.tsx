import { signOut } from "@/app/login/actions";
import { can, ROLES, type Profile } from "@/lib/roles";
import { NavShell, type NavGroup } from "./NavLinks";
import type { Tab } from "./TabBar";
import { createClient } from "@/lib/supabase/server";

const GROUPS: NavGroup[] = [
  { title: "", links: [{ href: "/", label: "Dashboard" }] },
  { title: "", links: [{ href: "/messages", label: "Messages" }] },
  { title: "", links: [{ href: "/documents", label: "Documents" }] },
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
      { href: "/customer-shop", label: "Customer page" },
      { href: "/sales/open", label: "Open orders" },
      { href: "/sales", label: "Sales orders" },
      { href: "/customers", label: "Customers" },
      { href: "/admin/logins", label: "Customer logins" },
      { href: "/catalog", label: "Sales catalog" },
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
  if (profile.role === "customer") {
    let inCart = 0;
    try {
      const supabase = await createClient();
      const { data } = await supabase.from("portal_cart_items").select("qty").eq("saved_for_later", false);
      inCart = (data ?? []).reduce((n: number, r: { qty: number }) => n + Number(r.qty), 0);
    } catch {
      /* the badge is optional */
    }
    return (
      <NavShell
        tabs={[
          { href: "/shop", label: "Shop", icon: "shop" },
          { href: "/shop/cart", label: "Cart", icon: "cart", badge: inCart },
          { href: "/settings", label: "Account", icon: "user" },
        ]}
        groups={[{ title: "", links: [{ href: "/shop", label: "Shop" }, { href: "/settings", label: "Settings" }, { href: "/settings/customize", label: "Customize page" }] }]}
        userName={profile.full_name || profile.email || ""}
        roleLabel="Customer"
        signOut={signOut}
      />
    );
  }
  let unread = 0;
  let waiting = 0;
  let resetWaiting = 0;
  let toSign = 0;
  try {
    const supabase = await createClient();
    const { data } = await supabase.rpc("chat_unread");
    unread = (data ?? []).reduce((n: number, r: { unread: number }) => n + Number(r.unread), 0);
    if (profile.email) {
      const { count } = await supabase.from("signature_requests").select("id", { count: "exact", head: true }).eq("status", "sent").ilike("recipient_email", profile.email.replace(/[%_\\]/g, "\\$&"));
      toSign = count ?? 0;
    }
    if (can(profile, "sales")) {
      // customer orders waiting on this person, as their assigned rep
      const { data: mine } = await supabase.from("sales_orders").select("id, customers!inner(rep_id)").eq("source", "portal").eq("status", "draft").eq("customers.rep_id", profile.id);
      waiting = mine?.length ?? 0;
      const { data: resets } = await supabase.rpc("pending_reset_count");
      resetWaiting = Number(resets ?? 0);
    }
  } catch {
    /* the badge is optional */
  }
  const settings: NavGroup = can(profile)
    ? {
        title: "Settings",
        links: [
          { href: "/settings", label: "Settings" },
          { href: "/settings/customize", label: "Customize page" },
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
          { href: "/settings/customize", label: "Customize page" },
          { href: "/settings/tutorials", label: "Tutorials" },
          { href: "/settings/knowledge-base", label: "Knowledge base" },
        ],
      };
  return (
    <NavShell
      tabs={staffTabs(profile.role, unread)}
      groups={[...GROUPS, settings].map((g) => ({ ...g, links: g.links.map((l) => (l.href === "/messages" && unread ? { ...l, label: `Messages (${unread})` } : l.href === "/documents" && toSign ? { ...l, label: `Documents (${toSign} to sign)` } : l.href === "/sales/open" && waiting ? { ...l, label: `Open orders (${waiting})` } : l.href === "/admin/logins" && resetWaiting ? { ...l, label: `Customer logins (${resetWaiting})` } : l)) }))}
      userName={profile.full_name || profile.email || ""}
      roleLabel={ROLES.find((r) => r.value === profile.role)?.label ?? ""}
      signOut={signOut}
    />
  );
}

/** Bottom tabs in Mobile mode: Home, two pages for the role, Messages (and Menu, added by the tab bar). */
function staffTabs(role: string, unread: number): Tab[] {
  const home: Tab = { href: "/", label: "Home", icon: "home" };
  const msgs: Tab = { href: "/messages", label: "Messages", icon: "messages", badge: unread };
  const mid: Record<string, Tab[]> = {
    admin: [
      { href: "/sales", label: "Orders", icon: "orders" },
      { href: "/inventory", label: "Inventory", icon: "inventory" },
    ],
    sales: [
      { href: "/counter", label: "Counter", icon: "counter" },
      { href: "/sales", label: "Orders", icon: "orders" },
    ],
    warehouse: [
      { href: "/scan", label: "Scan", icon: "scan" },
      { href: "/inventory", label: "Inventory", icon: "inventory" },
    ],
    orders_manager: [
      { href: "/sales", label: "Orders", icon: "orders" },
      { href: "/routing", label: "Routing", icon: "routing" },
    ],
    buyer: [
      { href: "/purchasing", label: "Buying", icon: "purchasing" },
      { href: "/receiving", label: "Receiving", icon: "receiving" },
    ],
  };
  return [home, ...(mid[role] ?? mid.buyer), msgs];
}
