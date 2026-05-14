// Telegram webhook endpoint.
//
// Security: grammY's `webhookCallback` validates Telegram's
// `X-Telegram-Bot-Api-Secret-Token` header against `secretToken`. If the
// header is missing or wrong, the callback responds 401 and the request
// never reaches a handler. We set this secret on the Telegram side via
// `setWebhook` (Wave 6).
//
// Pre-provisioning safety: if `TELEGRAM_BOT_TOKEN` is unset (Wave 0–5 dev /
// CI), constructing the grammY `Bot` would still succeed (we feed it a
// placeholder), but every Telegram API call would fail. Rather than confuse
// monitoring, we short-circuit with a 200 + `{ok: true, skipped: true}` so
// any background pinger / smoke test treats the endpoint as healthy.

import { webhookCallback } from "grammy";

import { bot, registerHandlers } from "@/lib/telegram/bot";

// Node runtime is required: the admin Supabase client + grammY's Node helpers
// pull in APIs that the Edge runtime doesn't support.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Wire handlers once at module load. `registerHandlers` is idempotent.
registerHandlers();

// Cache the callback closure across invocations. Recomputing it on every
// request would be wasteful on warm functions.
let _handler:
  | ((req: Request) => Promise<Response>)
  | null = null;

function getHandler(): (req: Request) => Promise<Response> {
  if (_handler) return _handler;
  _handler = webhookCallback(bot, "std/http", {
    secretToken: process.env.TELEGRAM_WEBHOOK_SECRET,
  });
  return _handler;
}

export async function POST(req: Request): Promise<Response> {
  // Without a bot token, we never registered a webhook upstream and can't
  // reply meaningfully. Return 200 so cron/CI pings stay green.
  if (
    !process.env.TELEGRAM_BOT_TOKEN ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return Response.json({ ok: true, skipped: true });
  }

  try {
    return await getHandler()(req);
  } catch (err) {
    // grammY's callback throws on validation failures (e.g. bad secret token).
    // Surface them as 200s WITHOUT processing so Telegram doesn't queue
    // unbounded retries; we log so we notice if the secret rotated.
    console.error("[telegram/webhook] handler error", err);
    return Response.json({ ok: false }, { status: 500 });
  }
}
