// Resolve a Telegram numeric user id to the app's authenticated user.
//
// The Telegram webhook has no Supabase session — every request is authenticated
// by the `X-Telegram-Bot-Api-Secret-Token` header (validated by grammY's
// `webhookCallback`). After that, the ONLY trustworthy way to derive the app
// `user_id` is to look up the linking record we wrote during `/start <code>`.
//
// IMPORTANT: this module ONLY uses the service-role admin client. Do not
// import from a browser context.

import { createAdminClient } from "@/lib/supabase/admin";

export interface LinkedUser {
  user_id: string;
  default_wallet_id: string | null;
  main_currency: string;
}

/**
 * Returns the linked user record for a given Telegram numeric user id, or
 * `null` if no linking row exists. Joins `profiles` to fetch the user's
 * `main_currency` so callers can format money in a single round-trip.
 */
export async function getLinkedUser(
  telegramUserId: number,
): Promise<LinkedUser | null> {
  // Pre-provisioning safety: if Supabase env is missing the admin client will
  // throw — callers should treat this as "unlinked" rather than crashing.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return null;
  }

  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch {
    return null;
  }

  const { data: tgRow, error: tgError } = await supabase
    .from("telegram_users")
    .select("user_id, default_wallet_id")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();

  if (tgError || !tgRow) {
    return null;
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("main_currency")
    .eq("id", tgRow.user_id)
    .maybeSingle();

  if (profileError || !profileRow) {
    return null;
  }

  return {
    user_id: tgRow.user_id,
    default_wallet_id: tgRow.default_wallet_id,
    main_currency: profileRow.main_currency,
  };
}
