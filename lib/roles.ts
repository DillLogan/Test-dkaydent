export type Role = "admin" | "buyer" | "warehouse" | "sales" | "orders_manager" | "customer";

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

/** Customer logins are set up on the Customer logins page, so they are not in the staff role list above. */
export const CUSTOMER_LABEL = "Customer";

/** Admin always passes. With no roles listed, only admin passes. */
export function can(profile: Pick<Profile, "role">, ...roles: Role[]) {
  return profile.role === "admin" || (profile.role !== "customer" && roles.includes(profile.role));
}
