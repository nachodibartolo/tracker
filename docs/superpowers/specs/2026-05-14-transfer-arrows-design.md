# Transfer-aware Transaction Row (arrows, no colors)

**Status:** Draft (pending user review)
**Date:** 2026-05-14
**Author:** Claude (brainstormed with @nachodibartolo)
**Scope:** Visual change to how transfer legs render in transaction lists.

## Problem

Transfers between wallets are stored as **two rows** in `transactions`:

| field                | OUT leg                 | IN leg                  |
| -------------------- | ----------------------- | ----------------------- |
| `type`               | `transfer`              | `transfer`              |
| `transfer_direction` | `out`                   | `in`                    |
| `wallet_id`          | source wallet           | destination wallet      |
| `counterpart_wallet_id` | destination wallet   | source wallet           |
| `transfer_group_id`  | shared UUID             | shared UUID             |

Both legs render through `components/transactions/transaction-row.tsx`, which only
distinguishes `income` from "everything else." For a transfer leg the row
currently shows:

- The fallback gray circle with a `−` glyph (no category icon).
- "Sin descripción" in the title slot (no description, no payee, no category).
- A red `−$ 180.000,00` amount (because `isIncome = type === "income"` is false).

The result on the dashboard: two identical-looking red rows that read as
expenses, when they're actually a single transfer between wallets.

## Goal

Make transfer legs visually distinct so the user instantly understands the
direction (out vs in) and the counterpart wallet, without using color.

## Non-goals

- Linking the row to a transfer-aware detail page (today it links to
  `/transactions/[id]` which exists but doesn't render transfer fields).
- Re-routing the row's "Eliminar" action through `deleteTransfer` instead of
  `deleteTransaction`. Today `deleteTransaction` rejects transfers with the
  toast "No se puede borrar una transferencia aquí" — pre-existing behavior,
  not introduced by this change. Listed as **Follow-up #1** below.
- Refactoring `TransferRow` (the standalone row used on `/transfers`).
- Changing how transfers are listed/filtered. They remain interleaved with
  other transactions in `RecentTransactions` and `/transactions`.

## Design

### Visual

For rows with `type === "transfer"`:

- **Left icon circle:** neutral gray (`bg-muted text-muted-foreground`) with
  `ArrowUp` (out) or `ArrowDown` (in) from `@phosphor-icons/react`. Replaces
  the category-colored circle.
- **Title slot:** `"Transferencia a {counterpart.name}"` for the OUT leg,
  `"Transferencia desde {counterpart.name}"` for the IN leg. Replaces the
  `description || payee || category.name || "Sin descripción"` fallback.
- **Subtitle slot:** only the time (`HH:mm`). Drops the `· {wallet.name}`
  fallback that today fires because there's no description/payee/category —
  the wallet is already shown by the badge on the right.
- **Amount:** `text-foreground` (neutral), no `+` or `−` sign. Preceded by a
  small `ArrowUp`/`ArrowDown` (size-3.5, `text-muted-foreground`) inline.
- **Wallet badge (right):** unchanged. Still the row's own wallet — i.e.
  MERCADOPAGO on the OUT leg, ICBC on the IN leg. Consistent with the
  description ("Transferencia a ICBC" + MERCADOPAGO badge reads as
  "from MERCADOPAGO going to ICBC").

For rows with `type === "expense"` or `"income"`: **no change**. Same red/green
colors, same `+`/`−` signs, same category icon.

### Data

Today `TransactionWithRefs` (in `lib/domain/transactions.ts`) only joins the
row's own wallet and its category. To show the counterpart wallet name we
extend it:

```ts
export type TransactionWithRefs = Transaction & {
  wallet: Pick<Wallet, "id" | "name" | "currency" | "color" | "icon">;
  category: Pick<Category, "id" | "name" | "color" | "icon"> | null;
  counterpartWallet: Pick<Wallet, "id" | "name"> | null; // NEW
};
```

The `TX_SELECT` string gains one more join:

```sql
counterpart_wallet:wallets!transactions_counterpart_wallet_id_fkey ( id, name )
```

For non-transfer rows `counterpart_wallet_id` is `NULL`, so the join yields
`null` and adds zero bytes to the response. `getTransactionById` uses the
same `TX_SELECT`, so it picks the change up for free.

### i18n

Two new strings in `lib/i18n.ts` under `transaction:`:

- `transferTo: "Transferencia a"` — concatenated with counterpart name.
- `transferFrom: "Transferencia desde"` — concatenated with counterpart name.

Kept as prefixes (not template strings) so they stay simple — the component
joins them with `${prefix} ${counterpartWallet.name}`. Edge case: if the
counterpart wallet has been deleted (`counterpartWallet === null`), fall back
to `t.transaction.transfer` (existing string: "Transferencia") with no
counterpart suffix.

### Component

In `components/transactions/transaction-row.tsx`:

```tsx
const isTransfer = row.type === "transfer";
const isOutgoing = isTransfer && row.transfer_direction === "out";
const isIncome = !isTransfer && row.type === "income";

// icon area
{isTransfer ? (
  <span className="...bg-muted text-muted-foreground...">
    {isOutgoing ? <ArrowUp /> : <ArrowDown />}
  </span>
) : (
  /* existing category icon block */
)}

// title
{isTransfer
  ? row.counterpartWallet
    ? `${isOutgoing ? t.transaction.transferTo : t.transaction.transferFrom} ${row.counterpartWallet.name}`
    : t.transaction.transfer
  : (row.description || row.payee || row.category?.name || "Sin descripción")}

// subtitle (transfers: time only; non-transfers: existing logic)

// amount
<p className={cn(
  "font-heading text-base font-semibold tabular-nums leading-tight",
  isTransfer
    ? "inline-flex items-center gap-1 text-foreground"
    : isIncome
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-destructive",
)}>
  {isTransfer ? (
    isOutgoing ? <ArrowUp className="size-3.5" weight="bold" /> : <ArrowDown className="size-3.5" weight="bold" />
  ) : null}
  {!isTransfer && (isIncome ? "+" : "-")}
  {formatCurrency(Number(row.amount), row.wallet.currency)}
</p>
```

(Final code may diverge in specifics — this is the shape, not the final patch.)

### Files touched

1. `lib/domain/transactions.ts` — extend `TransactionWithRefs`, extend `TX_SELECT`.
2. `components/transactions/transaction-row.tsx` — conditional branches above.
3. `lib/i18n.ts` — two new strings under `transaction:`.

Three files, no new components.

### Propagation

`TransactionRow` is rendered by:

- `components/dashboard/recent-transactions.tsx` (the dashboard screenshot).
- `components/transactions/transaction-list.tsx` (the `/transactions` page).

Both pick the change up automatically — no call-site changes needed.

The same component is **not** used by:

- `/transfers` — that's `components/transfers/transfer-row.tsx`, unchanged.
- `/wallets/[id]` — currently a Wave 3 placeholder, no transaction list yet.

## Testing

Manual verification on `/dashboard` and `/transactions`:

1. Existing expense rows still render red with `−`. (Regression check.)
2. Existing income rows still render green with `+`. (Regression check.)
3. A same-currency transfer between two wallets shows:
   - OUT leg with up arrow icon, "Transferencia a {dest}", neutral amount.
   - IN leg with down arrow icon, "Transferencia desde {source}", neutral amount.
4. A cross-currency transfer (e.g. ARS → USD) — both legs still render with
   their own currency's amount; the FX shape is not displayed in this row (it
   never was, and the user didn't ask for it).
5. A transfer whose counterpart wallet has been deleted (rare but possible
   via `wallets.delete`) — fallback to plain "Transferencia" with no
   counterpart suffix, no crash.

Mobile (iOS Safari) check: the inline arrow next to the amount should not
push the wallet badge off the right edge on a 360px-wide screen with a long
counterpart name. If it does, the counterpart name truncates first (`truncate`
on the title slot already handles this).

## Follow-ups (separate spec)

These are pre-existing UX gaps that this change makes more visible:

1. **Eliminar action on transfer legs.** Today the 3-dot menu's "Eliminar"
   triggers `deleteTransaction(row.id)`, which rejects with
   `"No se puede borrar una transferencia aquí"`. With transfer legs now
   clearly identifiable, users will be more tempted to use this menu. Fix:
   when `row.type === "transfer"`, route delete through
   `deleteTransfer(row.transfer_group_id)` and update the confirm dialog copy.
2. **Row click navigation.** Today the row links to `/transactions/[id]`,
   which exists but doesn't render transfer-specific fields (direction,
   counterpart, fx_rate). Either make `/transactions/[id]` transfer-aware or
   redirect transfer legs to a future `/transfers/[group_id]` detail page.

## Open questions

None at time of writing. Two questions were resolved during brainstorming:

- **Arrow placement** → both: in the icon circle (left) *and* inline before
  the amount (right). Double emphasis.
- **Description text** → show counterpart wallet ("Transferencia a {wallet}"),
  not generic "Transferencia."
