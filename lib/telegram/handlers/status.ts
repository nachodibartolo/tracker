// /saldo + /ultimos — read-only status commands.
//
// Both commands derive the app user via `getLinkedUser(ctx.from.id)`. If the
// user hasn't linked yet we reply with the same onboarding text the catch-all
// uses, so the bot is helpful even when invoked too early.
//
// Replies use MarkdownV2 so we can render code blocks for amounts. The
// `escapeMd` helper escapes the full MarkdownV2 reserved set; if you forget
// any character, Telegram rejects the whole message.

import type { Bot, CommandContext, Context } from "grammy";

import { formatCurrency } from "@/lib/format";
import { convert } from "@/lib/fx/convert";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLinkedUser } from "@/lib/telegram/get-linked-user";

const ONBOARDING_TEXT =
  "Necesitás vincular tu cuenta primero. Andá a la app, generá un código en Ajustes → Telegram y mandámelo con `/start <codigo>`.";

// MarkdownV2 reserved characters per the Telegram Bot API spec.
// https://core.telegram.org/bots/api#markdownv2-style
const MD_V2_ESCAPE_RE = /[_*[\]()~`>#+\-=|{}.!\\]/g;

/**
 * Escape a string so it can be safely inserted into a MarkdownV2 message.
 * The Telegram API rejects messages with unescaped reserved characters.
 */
export function escapeMd(s: string): string {
  return s.replace(MD_V2_ESCAPE_RE, "\\$&");
}

export function registerStatusHandlers(bot: Bot): void {
  bot.command("saldo", handleSaldo);
  bot.command("ultimos", handleUltimos);
}

// ---------- /saldo ----------------------------------------------------------

async function handleSaldo(ctx: CommandContext<Context>): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const linked = await getLinkedUser(from.id);
  if (!linked) {
    await ctx.reply(ONBOARDING_TEXT, { parse_mode: "Markdown" });
    return;
  }

  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch {
    await ctx.reply("Algo falló consultando tu saldo.");
    return;
  }

  // Pull all wallets that count toward the balance: not archived AND not
  // excluded from stats. Order by `position` for a stable, user-controlled
  // ordering.
  const { data: wallets, error: walletsError } = await supabase
    .from("wallets")
    .select("id, name, currency, initial_balance, position")
    .eq("user_id", linked.user_id)
    .eq("archived", false)
    .eq("excluded_from_stats", false)
    .order("position", { ascending: true });

  if (walletsError || !wallets || wallets.length === 0) {
    await ctx.reply("No tenés wallets activas.");
    return;
  }

  const walletIds = wallets.map((w) => w.id);

  // Sum income/expense/transfer amounts per wallet from `transactions`. We
  // fetch the raw rows and aggregate in JS because Wave 3 doesn't ship a
  // server-side view yet (that's a future optimization). The volumes are
  // single-user-scale so this is fine for now.
  const { data: txs, error: txsError } = await supabase
    .from("transactions")
    .select(
      "wallet_id, counterpart_wallet_id, type, amount, counterpart_amount",
    )
    .eq("user_id", linked.user_id)
    .in("wallet_id", walletIds);

  if (txsError) {
    await ctx.reply("Algo falló consultando tu saldo.");
    return;
  }

  // Walk transactions and accumulate the running balance per wallet.
  const deltaByWallet = new Map<string, number>();
  for (const w of wallets) deltaByWallet.set(w.id, 0);
  for (const tx of txs ?? []) {
    const sourceDelta =
      tx.type === "income"
        ? Number(tx.amount)
        : tx.type === "expense"
          ? -Number(tx.amount)
          : -Number(tx.amount); // transfer leg out
    if (deltaByWallet.has(tx.wallet_id)) {
      deltaByWallet.set(
        tx.wallet_id,
        (deltaByWallet.get(tx.wallet_id) ?? 0) + sourceDelta,
      );
    }
    if (
      tx.type === "transfer" &&
      tx.counterpart_wallet_id &&
      deltaByWallet.has(tx.counterpart_wallet_id)
    ) {
      const counter = Number(tx.counterpart_amount ?? tx.amount);
      deltaByWallet.set(
        tx.counterpart_wallet_id,
        (deltaByWallet.get(tx.counterpart_wallet_id) ?? 0) + counter,
      );
    }
  }

  // Build the response. Each wallet line shows native-currency balance; the
  // grand total is converted to the user's `main_currency` via `convert()`.
  const main = linked.main_currency.toUpperCase();
  const lines: string[] = [];
  let totalInMain = 0;
  let fxFailed = false;

  for (const w of wallets) {
    const native = Number(w.initial_balance) + (deltaByWallet.get(w.id) ?? 0);
    lines.push(
      `• ${escapeMd(w.name)}: \`${escapeMd(formatCurrency(native, w.currency))}\``,
    );
    try {
      const converted = await convert(native, w.currency, main);
      totalInMain += converted;
    } catch (err) {
      console.error("[telegram/saldo] fx convert failed", err);
      fxFailed = true;
    }
  }

  const totalLine = fxFailed
    ? `*Total ${escapeMd(`(${main})`)}*: \`?\``
    : `*Total ${escapeMd(`(${main})`)}*: \`${escapeMd(formatCurrency(totalInMain, main))}\``;

  await ctx.reply([totalLine, ...lines].join("\n"), {
    parse_mode: "MarkdownV2",
  });
}

// ---------- /ultimos --------------------------------------------------------

interface UltimosRow {
  id: string;
  occurred_at: string;
  amount: number;
  currency: string;
  type: string;
  description: string | null;
  payee: string | null;
  wallet_id: string;
  category_id: string | null;
}

async function handleUltimos(ctx: CommandContext<Context>): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const linked = await getLinkedUser(from.id);
  if (!linked) {
    await ctx.reply(ONBOARDING_TEXT, { parse_mode: "Markdown" });
    return;
  }

  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch {
    await ctx.reply("Algo falló consultando tus transacciones.");
    return;
  }

  const { data: txs, error } = await supabase
    .from("transactions")
    .select(
      "id, occurred_at, amount, currency, type, description, payee, wallet_id, category_id",
    )
    .eq("user_id", linked.user_id)
    .order("occurred_at", { ascending: false })
    .limit(5);

  if (error) {
    await ctx.reply("Algo falló consultando tus transacciones.");
    return;
  }

  const rows = (txs ?? []) as UltimosRow[];
  if (rows.length === 0) {
    await ctx.reply("Todavía no tenés transacciones.");
    return;
  }

  // Resolve wallet/category names in one extra query each. Single-user scale,
  // 5 rows max → totally fine without a view.
  const walletIds = Array.from(new Set(rows.map((r) => r.wallet_id)));
  const categoryIds = Array.from(
    new Set(rows.map((r) => r.category_id).filter((v): v is string => !!v)),
  );

  const [walletsRes, categoriesRes] = await Promise.all([
    supabase
      .from("wallets")
      .select("id, name")
      .in("id", walletIds)
      .eq("user_id", linked.user_id),
    categoryIds.length > 0
      ? supabase
          .from("categories")
          .select("id, name")
          .in("id", categoryIds)
          .eq("user_id", linked.user_id)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const walletNameById = new Map<string, string>();
  for (const w of walletsRes.data ?? []) walletNameById.set(w.id, w.name);
  const categoryNameById = new Map<string, string>();
  for (const c of categoriesRes.data ?? []) categoryNameById.set(c.id, c.name);

  const lines = rows.map((tx, idx) => {
    const date = tx.occurred_at.slice(0, 10); // YYYY-MM-DD
    const sign = tx.type === "income" ? "+" : tx.type === "expense" ? "-" : "↔";
    const amount = formatCurrency(Number(tx.amount), tx.currency);
    const wallet = walletNameById.get(tx.wallet_id) ?? "?";
    const category = tx.category_id
      ? (categoryNameById.get(tx.category_id) ?? "?")
      : "Sin categoría";
    const desc = tx.description ?? tx.payee ?? "";
    const descPart = desc ? ` — ${desc}` : "";
    return (
      `${idx + 1}\\. ${escapeMd(date)} ${escapeMd(sign)}\`${escapeMd(amount)}\` ` +
      `${escapeMd(wallet)} · ${escapeMd(category)}${escapeMd(descPart)}`
    );
  });

  const header = `*Últimas ${rows.length} transacciones*`;
  await ctx.reply([header, ...lines].join("\n"), {
    parse_mode: "MarkdownV2",
  });
}
