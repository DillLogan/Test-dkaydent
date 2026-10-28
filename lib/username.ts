/** Customers sign in with a username. Behind the scenes it is stored as an address no one can email. */
export const CUSTOMER_DOMAIN = "customers.dkaydent.app";

export function isValidUsername(u: string) {
  return /^[a-z0-9][a-z0-9._-]{2,29}$/.test(u);
}

/** Whatever was typed on the login page, as the email Supabase knows. Anything with an @ is a normal email. */
export function loginEmail(typed: string) {
  const t = typed.trim();
  return t.includes("@") ? t : `${t.toLowerCase()}@${CUSTOMER_DOMAIN}`;
}

/** The username to show for a stored address. */
export function usernameOf(email: string | null | undefined) {
  return email && email.endsWith(`@${CUSTOMER_DOMAIN}`) ? email.slice(0, -CUSTOMER_DOMAIN.length - 1) : (email ?? "");
}
