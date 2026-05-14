"use server";

// Server actions for managing personal access tokens used by the iOS
// Shortcut → /api/voice/agent flow. The plaintext token is shown to the
// user ONCE (returned from `createVoiceToken`); only the sha256 hex hash
// is persisted in `voice_tokens.token_hash`.
//
// Revocation is a soft-delete (UPDATE … SET revoked_at = now()) so we
// keep `last_used_at` for audit. The endpoint filters revoked rows.

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { generateVoiceToken, hashVoiceToken } from "@/lib/voice-tokens/tokens";

export type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export interface CreatedVoiceToken {
  id: string;
  token: string; // plaintext, shown once
  label: string;
}

export async function createVoiceToken(input: {
  label: string;
  default_wallet_id: string | null;
}): Promise<ActionResult<CreatedVoiceToken>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "No autenticado" };
  }

  const label = input.label.trim();
  if (label.length === 0 || label.length > 60) {
    return { ok: false, error: "Label inválido (1–60 caracteres)" };
  }

  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return { ok: false, error: "Backend no configurado" };
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Configuración inválida",
    };
  }

  const token = generateVoiceToken();
  const tokenHash = hashVoiceToken(token);

  // sha256 collisions on 32 bytes of randomness are astronomical; we treat
  // unique-violation as a fatal misconfiguration, not a retryable error.
  const { data, error } = await admin
    .from("voice_tokens")
    .insert({
      user_id: user.id,
      token_hash: tokenHash,
      label,
      default_wallet_id: input.default_wallet_id,
    })
    .select("id, label")
    .single();

  if (error || !data) {
    return {
      ok: false,
      error: error?.message ?? "No se pudo crear el token",
    };
  }

  revalidatePath("/settings/voice");
  return {
    ok: true,
    data: { id: data.id, label: data.label, token },
  };
}

export async function revokeVoiceToken(tokenId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "No autenticado" };
  }

  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return { ok: false, error: "Backend no configurado" };
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Configuración inválida",
    };
  }

  // Scope the update to BOTH id AND user_id so a leaked token-id from
  // another user can't be revoked by us. The admin client bypasses RLS;
  // we enforce the ownership invariant in the WHERE clause.
  const { error } = await admin
    .from("voice_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", tokenId)
    .eq("user_id", user.id);

  if (error) {
    return { ok: false, error: error.message ?? "No se pudo revocar" };
  }

  revalidatePath("/settings/voice");
  return { ok: true };
}

export interface VoiceTokenRow {
  id: string;
  label: string;
  default_wallet_id: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export async function listVoiceTokens(): Promise<ActionResult<VoiceTokenRow[]>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "No autenticado" };
  }

  // Read via the user-scoped client so RLS enforces "own rows only" —
  // belt-and-suspenders with the explicit filter below.
  const { data, error } = await supabase
    .from("voice_tokens")
    .select("id, label, default_wallet_id, created_at, last_used_at, revoked_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return { ok: false, error: error.message ?? "No se pudo listar" };
  }
  return { ok: true, data: data ?? [] };
}
