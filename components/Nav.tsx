import { signOut } from "@/app/login/actions";
import { can, ROLES, type Profile } from "@/lib/roles";
import { NavShell, type NavGroup } from "./NavLinks";

const GROUPS: NavGroup[] = [
  { title: "", links: [{ href: "/", label: "Dashboard" }] },
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

export function Nav({ profile }: { profile: Profile }) {
  const settings: NavGroup = can(profile)
    ? {
        title: "Settings",
        links: [
          { href: "/settings", label: "Settings" },
          { href: "/admin/users", label: "Users & roles" },
          { href: "/settings/web-store", label: "Web store" },
          { href: "/settings/routing", label: "Maps & routing" },
        ],
      }
    : { title: "", links: [{ href: "/settings", label: "Settings" }] };
  return (
    <NavShell
      groups={[...GROUPS, settings]}
      userName={profile.full_name || profile.email || ""}
      roleLabel={ROLES.find((r) => r.value === profile.role)?.label ?? ""}
      signOut={signOut}
    />
  );
}
