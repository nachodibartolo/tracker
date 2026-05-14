import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// IMPORTANT: this client uses the service-role key and bypasses RLS.
// Only import from server-only contexts (Telegram webhook, cron jobs).
// Every query MUST manually scope by user_id derived from a trusted source.

let cached: ReturnType<typeof createClient<Database>> | null = null;

export function createAdminClient() {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase env vars for admin client");
  }
  cached = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
