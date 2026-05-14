// Voice / Siri Shortcut entry point.
//
// Auth: Authorization: Bearer vt_…  →  sha256 lookup in voice_tokens.
// Body: { text: string }            →  delegates to runExpenseAgent.
// Reply: { ok: boolean, text: string }
//
// Errors are returned as 200 with ok:false so that the iOS Shortcut can
// always "speak" the text aloud. Only auth/body failures return non-2xx.

import { z } from "zod";

import { AgentQuotaError, runExpenseAgent } from "@/lib/ai/agent";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashVoiceToken } from "@/lib/voice-tokens/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The agent can take a while under free-tier rate limiting; we run
// synchronously so the Shortcut gets the text back to read aloud.
export const maxDuration = 300;

const BodySchema = z.object({
  text: z.string().trim().min(1).max(2000),
});

const QUOTA_TEXT = "Mi cuota AI llegó al límite. Probá mañana.";
const GENERIC_TEXT = "Algo falló procesando tu mensaje. Probá de nuevo.";

export async function POST(req: Request): Promise<Response> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return Response.json({ ok: false }, { status: 401 });
  }
  const plain = authHeader.slice("bearer ".length).trim();
  if (!plain.startsWith("vt_") || plain.length < 10) {
    return Response.json({ ok: false }, { status: 401 });
  }

  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return Response.json({ ok: false }, { status: 503 });
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }

  const hash = hashVoiceToken(plain);
  const { data: tokenRow } = await admin
    .from("voice_tokens")
    .select("id, user_id, default_wallet_id")
    .eq("token_hash", hash)
    .is("revoked_at", null)
    .maybeSingle();

  if (!tokenRow) {
    return Response.json({ ok: false }, { status: 401 });
  }

  // Best-effort touch of last_used_at; do not block the response on it.
  void admin
    .from("voice_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", tokenRow.id);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false }, { status: 400 });
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("main_currency")
    .eq("id", tokenRow.user_id)
    .maybeSingle();
  if (!profile) {
    // No profile row means provisioning is incomplete — surface a
    // readable message rather than a stack trace.
    return Response.json({ ok: false, text: GENERIC_TEXT });
  }

  try {
    const out = await runExpenseAgent({
      supabase: admin,
      userId: tokenRow.user_id,
      chatId: -1, // sentinel: this invocation came from the voice endpoint
      mainCurrency: profile.main_currency,
      text: parsed.data.text,
      defaultWalletId: tokenRow.default_wallet_id ?? undefined,
    });
    return Response.json({ ok: true, text: out.text });
  } catch (err) {
    if (err instanceof AgentQuotaError) {
      return Response.json({ ok: false, text: QUOTA_TEXT });
    }
    console.error("[voice/agent] failed", err);
    return Response.json({ ok: false, text: GENERIC_TEXT });
  }
}
