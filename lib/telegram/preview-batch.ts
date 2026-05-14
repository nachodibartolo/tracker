// Render del mensaje de preview cuando hay un batch (>=1 item). Reutiliza
// `escapeMd` de `handlers/status.ts` para MarkdownV2. Si el batch tiene 1
// solo item podríamos reusar el preview legacy, pero unificamos por DRY:
// 1 item se ve como "Encontré 1 movimiento" + lista de 1.

import type { ExpenseItem } from "@/lib/ai/schemas";
import { formatCurrency, formatDate } from "@/lib/format";

import { escapeMd } from "./handlers/status";

export interface BatchPreviewItemInput {
  batch_index: number;
  item: ExpenseItem;
  category_label: string;
  is_duplicate: boolean;
  duplicate_label: string | null;
  transfer_hint: boolean;
  counterpart_wallet_name: string | null;
  excluded: boolean;
}

export interface BatchPreviewInput {
  walletName: string;
  walletCurrency: string;
  items: BatchPreviewItemInput[];
}

export interface PreviewMessage {
  text: string;
  markdown: "MarkdownV2";
}

function iconFor(item: BatchPreviewItemInput): string {
  if (item.excluded) return "⏭️";
  if (item.is_duplicate) return "⚠️";
  if (item.counterpart_wallet_name) return "🔁";
  if (item.transfer_hint) return "🔄";
  return "✨";
}

function shortDate(iso: string | null): string {
  if (!iso) return "?";
  return formatDate(iso, "dd/MM");
}

export function buildBatchPreview(input: BatchPreviewInput): PreviewMessage {
  const { walletName, items } = input;
  const lines: string[] = [];
  lines.push(`📋 *Encontré ${items.length} ${items.length === 1 ? "movimiento" : "movimientos"}* — Wallet: *${escapeMd(walletName)}*`);
  lines.push("");

  let nuevos = 0;
  let dups = 0;
  let transfers = 0;
  let totalExpense = 0;
  let totalIncome = 0;

  for (const it of items) {
    const icon = iconFor(it);
    const idxStr = String(it.batch_index + 1).padStart(2, " ");
    const dateStr = escapeMd(shortDate(it.item.occurred_at));
    const amountStr =
      it.item.amount !== null
        ? escapeMd(formatCurrency(it.item.amount, it.item.currency ?? input.walletCurrency))
        : "?";
    const payee = escapeMd(it.item.payee ?? it.item.description ?? "—");
    const catLabel = escapeMd(it.category_label);
    const suffix = it.is_duplicate && it.duplicate_label
      ? ` \\(dup ${escapeMd(it.duplicate_label)}\\)`
      : it.counterpart_wallet_name
        ? ` → ${escapeMd(it.counterpart_wallet_name)}`
        : "";

    lines.push(`  ${idxStr}\\. ${icon} ${dateStr} · \`${amountStr}\` · ${payee} · ${catLabel}${suffix}`);

    if (!it.excluded) {
      if (it.is_duplicate) dups++;
      else nuevos++;
      if (it.counterpart_wallet_name) transfers++;
      else if (it.item.amount !== null) {
        if (it.item.type === "expense") totalExpense += it.item.amount;
        if (it.item.type === "income") totalIncome += it.item.amount;
      }
    }
  }

  lines.push("");
  lines.push(`📊 Resumen: ${nuevos} nuevos · ${dups} duplicados · ${transfers} transfers marcados`);
  if (totalExpense > 0 || totalIncome > 0) {
    lines.push(
      `💰 Total: ${escapeMd(formatCurrency(totalExpense, input.walletCurrency))} gastos · ${escapeMd(formatCurrency(totalIncome, input.walletCurrency))} ingresos`,
    );
  }

  return { text: lines.join("\n"), markdown: "MarkdownV2" };
}

const PREVIEW_MAX_CHARS = 3800;

export function paginatePreview(text: string): string[] {
  if (text.length <= PREVIEW_MAX_CHARS) return [text];
  const lines = text.split("\n");
  const pages: string[] = [];
  let buf: string[] = [];
  let len = 0;
  for (const line of lines) {
    if (len + line.length + 1 > PREVIEW_MAX_CHARS) {
      pages.push(buf.join("\n"));
      buf = [];
      len = 0;
    }
    buf.push(line);
    len += line.length + 1;
  }
  if (buf.length > 0) pages.push(buf.join("\n"));
  return pages;
}
