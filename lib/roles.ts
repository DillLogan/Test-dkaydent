export type Role = "admin" | "buyer" | "warehouse" | "sales" | "orders_manager";

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
  active: boolean;
};

export const ROLES: { value: Role; label: string; description: string }[] = [
  { value: "admin", label: "Admin", description: "Everything, including user management" },
  { value: "buyer", label: "Buyer", description: "Products, vendors, purchase orders, receiving" },
  { value: "warehouse", label: "Warehouse", description: "Locations, receiving, transfers, shrink, counts, fulfillment" },
  { value: "sales", label: "Sales", description: "Customers, pricing, sales orders, invoices" },
  { value: "orders_manager", label: "Orders manager", description: "Checks pulled orders, marks them completed, invoices, builds delivery routes" },
];

/** Admin always passes. With no roles listed, only admin passes. */
export function can(profile: Pick<Profile, "role">, ...roles: Role[]) {
  return profile.role === "admin" || roles.includes(profile.role);
}
