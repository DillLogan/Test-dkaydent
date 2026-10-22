import { createClient } from "@supabase/supabase-js";

/** Database client for server-to-server calls (webhooks, scheduled jobs). Needs SUPABASE_SERVICE_ROLE_KEY. */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false } });
}
