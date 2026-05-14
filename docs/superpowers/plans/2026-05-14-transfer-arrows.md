# Transfer-aware Transaction Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make transfer legs visually distinct in transaction lists — neutral gray arrow icons (↑ outgoing, ↓ incoming), no red/green colors, descriptive title naming the counterpart wallet.

**Architecture:** Single-component change with one data-layer extension. `TransactionRow` (the row used by the dashboard and `/transactions`) gains a `row.type === "transfer"` branch that swaps the icon, title, and amount styling. `TransactionWithRefs` is extended with a `counterpartWallet: Pick<Wallet, "id" | "name"> | null` field, populated by a new join in `TX_SELECT`. No new component, no new abstraction.

**Tech Stack:** Next.js App Router, TypeScript, Tailwind, Supabase (PostgREST), `@phosphor-icons/react` for icons.

**Spec:** `docs/superpowers/specs/2026-05-14-transfer-arrows-design.md`

**Test strategy:** This repo has no test runner (only `lint`, `typecheck`, and a Next build). Verification is per-task:
- `pnpm typecheck` — catches type-shape errors after Task 2.
- `pnpm lint` — quality after every task.
- `pnpm dev` + manual browser walkthrough — Task 4 validates the visual outcome end-to-end against the spec.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `lib/i18n.ts` | Two new prefix strings under `transaction:` — `transferTo`, `transferFrom`. | 1 |
| `lib/domain/transactions.ts` | Extend `TransactionWithRefs` with `counterpartWallet`, add counterpart join to `TX_SELECT`. | 2 |
| `components/transactions/transaction-row.tsx` | Branch on `row.type === "transfer"` to render gray arrow icon, counterpart-aware title, neutral amount with inline arrow. | 3 |

No new files. No call-site changes (`RecentTransactions`, `TransactionList`, and the wallet detail page all consume `TransactionRow` unchanged).

---

## Task 1: Add i18n strings for transfer direction

**Files:**
- Modify: `lib/i18n.ts:35-58` (the `transaction:` block)

- [ ] **Step 1: Add `transferTo` and `transferFrom` to the `transaction` object**

Open `lib/i18n.ts` and add the two new keys inside the `transaction:` block. Existing keys (e.g. `transfer: "Transferencia"`) stay untouched — the new keys are prefixes used when the counterpart wallet name is known.

Apply this Edit:

```ts
// before
  transaction: {
    new: "Nueva transacción",
    edit: "Editar transacción",
    editCategory: "Editar categoría",
    expense: "Gasto",
    income: "Ingreso",
    transfer: "Transferencia",
```

```ts
// after
  transaction: {
    new: "Nueva transacción",
    edit: "Editar transacción",
    editCategory: "Editar categoría",
    expense: "Gasto",
    income: "Ingreso",
    transfer: "Transferencia",
    transferTo: "Transferencia a",
    transferFrom: "Transferencia desde",
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: passes with no errors. (The `t` constant is `as const`, so adding string keys just widens the type.)

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add lib/i18n.ts
git commit -m "$(cat <<'EOF'
feat(i18n): add transferTo/transferFrom prefix strings

Used by the transaction row when rendering transfer legs alongside
the counterpart wallet name.
EOF
)"
```

---

## Task 2: Extend `TransactionWithRefs` with `counterpartWallet`

**Files:**
- Modify: `lib/domain/transactions.ts:21-49` (type + select string)

The counterpart wallet is the *other* wallet in a transfer (the destination for the OUT leg, the source for the IN leg). Both transfer legs already store it in `transactions.counterpart_wallet_id` — we just need to expose its `id` and `name` to the UI. For non-transfer rows the column is `NULL`, so the join yields `null` with no overhead.

- [ ] **Step 1: Add `counterpartWallet` to the `TransactionWithRefs` type**

Apply this Edit:

```ts
// before
export type TransactionWithRefs = Transaction & {
  wallet: Pick<Wallet, "id" | "name" | "currency" | "color" | "icon">;
  category: Pick<Category, "id" | "name" | "color" | "icon"> | null;
};
```

```ts
// after
export type TransactionWithRefs = Transaction & {
  wallet: Pick<Wallet, "id" | "name" | "currency" | "color" | "icon">;
  category: Pick<Category, "id" | "name" | "color" | "icon"> | null;
  counterpartWallet: Pick<Wallet, "id" | "name"> | null;
};
```

- [ ] **Step 2: Add the counterpart wallet join to `TX_SELECT`**

The existing `TX_SELECT` constant already aliases `wallets!transactions_wallet_id_fkey` as `wallet`. Add a parallel alias for the counterpart FK.

Apply this Edit:

```ts
// before
const TX_SELECT = `
  *,
  wallet:wallets!transactions_wallet_id_fkey ( id, name, currency, color, icon ),
  category:categories!transactions_category_id_fkey ( id, name, color, icon )
`;
```

```ts
// after
const TX_SELECT = `
  *,
  wallet:wallets!transactions_wallet_id_fkey ( id, name, currency, color, icon ),
  category:categories!transactions_category_id_fkey ( id, name, color, icon ),
  counterpartWallet:wallets!transactions_counterpart_wallet_id_fkey ( id, name )
`;
```

Notes for the engineer:
- PostgREST resolves the alias on the **left** of the colon and the FK name in the parentheses. The FK `transactions_counterpart_wallet_id_fkey` already exists in the schema (you can confirm with `grep counterpart_wallet_id lib/supabase/database.types.ts`).
- The cast `data as unknown as TransactionWithRefs[]` on line 97 doesn't need any change — the PostgREST response will simply include the new field.
- `getTransactionById` (line 107) uses the same `TX_SELECT` and picks the change up for free.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: passes. (Nothing reads `counterpartWallet` yet — it's just an additional optional field on the type.)

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: passes.

- [ ] **Step 5: Spot-check the join in dev**

Run the dev server (`pnpm dev`), then in the browser DevTools network tab on `/dashboard`, find the Supabase REST request to `/rest/v1/transactions?...`. Inspect one of the response rows for a transfer (you can tell by `type: "transfer"`). Confirm the row includes a `counterpartWallet: { id, name }` object.

Expected: transfer rows have a populated `counterpartWallet`, non-transfer rows have `counterpartWallet: null`.

If the join name fails (PostgREST returns an error mentioning "could not find a relationship"), the FK alias is wrong — re-check the FK name in `lib/supabase/database.types.ts` and adjust the parenthesised name to match.

- [ ] **Step 6: Commit**

```bash
git add lib/domain/transactions.ts
git commit -m "$(cat <<'EOF'
feat(transactions): join counterpart wallet on TransactionWithRefs

Adds counterpartWallet (id + name) to the type and TX_SELECT so the
transaction row can render transfer legs with the destination/source
wallet name. Non-transfer rows get null with no overhead.
EOF
)"
```

---

## Task 3: Render transfer legs with arrows in `TransactionRow`

**Files:**
- Modify: `components/transactions/transaction-row.tsx`

This is the visual change the user asked for. Four sub-changes to the same file: import the arrow icons, add direction booleans, swap the icon circle, swap the title and amount.

- [ ] **Step 1: Import `ArrowUp` and `ArrowDown` from phosphor**

Apply this Edit:

```tsx
// before
import { DotsThreeVertical, Pencil, Tag, Trash } from "@phosphor-icons/react";
```

```tsx
// after
import { ArrowDown, ArrowUp, DotsThreeVertical, Pencil, Tag, Trash } from "@phosphor-icons/react";
```

(Alphabetical order — the file already imports phosphor icons that way.)

- [ ] **Step 2: Add transfer detection booleans next to `isIncome`**

Find the line `const isIncome = row.type === "income";` (around line 109) and replace that single declaration block with three booleans:

```tsx
// before
  const CategoryIcon = row.category ? getCategoryIcon(row.category.icon) : null;
  const isIncome = row.type === "income";
```

```tsx
// after
  const CategoryIcon = row.category ? getCategoryIcon(row.category.icon) : null;
  const isTransfer = row.type === "transfer";
  const isOutgoing = isTransfer && row.transfer_direction === "out";
  const isIncome = !isTransfer && row.type === "income";
```

Why: `isIncome` is now scoped to non-transfer rows so the green styling never fires on a transfer leg. `isTransfer` and `isOutgoing` are the gates for the new branches below.

- [ ] **Step 3: Replace the icon circle block with a transfer-aware branch**

Find the `{/* Category icon */}` block (around line 129). Replace the whole `<span aria-hidden ...>` block with this conditional:

```tsx
// before
          {/* Category icon */}
          <span
            aria-hidden
            className="flex size-11 flex-shrink-0 items-center justify-center rounded-full text-white shadow-sm"
            style={{
              backgroundColor: row.category?.color ?? "#64748b",
            }}
          >
            {CategoryIcon ? (
              <CategoryIcon className="size-5" weight="fill" />
            ) : (
              <span aria-hidden className="text-xs font-semibold">
                {isIncome ? "+" : "-"}
              </span>
            )}
          </span>
```

```tsx
// after
          {/* Icon: category color for expense/income, neutral gray with
              direction arrow for transfer legs. */}
          {isTransfer ? (
            <span
              aria-hidden
              className="flex size-11 flex-shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground shadow-sm"
            >
              {isOutgoing ? (
                <ArrowUp className="size-5" weight="bold" />
              ) : (
                <ArrowDown className="size-5" weight="bold" />
              )}
            </span>
          ) : (
            <span
              aria-hidden
              className="flex size-11 flex-shrink-0 items-center justify-center rounded-full text-white shadow-sm"
              style={{
                backgroundColor: row.category?.color ?? "#64748b",
              }}
            >
              {CategoryIcon ? (
                <CategoryIcon className="size-5" weight="fill" />
              ) : (
                <span aria-hidden className="text-xs font-semibold">
                  {isIncome ? "+" : "-"}
                </span>
              )}
            </span>
          )}
```

- [ ] **Step 4: Replace the description/subtitle block with a transfer-aware branch**

Find the `{/* Description / payee */}` block (around line 146). Replace the full `<div className="min-w-0 flex-1">` block with this conditional. For transfers we show "Transferencia a/desde {counterpart}" on line 1 and just the time on line 2; for non-transfers the existing logic is preserved verbatim.

```tsx
// before
          {/* Description / payee */}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight">
              {row.description || row.payee || row.category?.name || "Sin descripción"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              <span className="tabular-nums">
                {formatDate(row.occurred_at, "HH:mm")}
              </span>
              {row.payee && row.description ? (
                <>
                  <span aria-hidden> · </span>
                  {row.payee}
                </>
              ) : null}
              {row.category ? (
                <>
                  <span aria-hidden> · </span>
                  {row.category.name}
                </>
              ) : !row.payee && !row.description ? (
                <>
                  <span aria-hidden> · </span>
                  {row.wallet.name}
                </>
              ) : null}
            </p>
          </div>
```

```tsx
// after
          {/* Description / payee. Transfers get a counterpart-aware title;
              everything else keeps the description/payee/category fallback. */}
          <div className="min-w-0 flex-1">
            {isTransfer ? (
              <>
                <p className="truncate text-sm font-medium leading-tight">
                  {row.counterpartWallet
                    ? `${
                        isOutgoing
                          ? t.transaction.transferTo
                          : t.transaction.transferFrom
                      } ${row.counterpartWallet.name}`
                    : t.transaction.transfer}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    {formatDate(row.occurred_at, "HH:mm")}
                  </span>
                </p>
              </>
            ) : (
              <>
                <p className="truncate text-sm font-medium leading-tight">
                  {row.description || row.payee || row.category?.name || "Sin descripción"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    {formatDate(row.occurred_at, "HH:mm")}
                  </span>
                  {row.payee && row.description ? (
                    <>
                      <span aria-hidden> · </span>
                      {row.payee}
                    </>
                  ) : null}
                  {row.category ? (
                    <>
                      <span aria-hidden> · </span>
                      {row.category.name}
                    </>
                  ) : !row.payee && !row.description ? (
                    <>
                      <span aria-hidden> · </span>
                      {row.wallet.name}
                    </>
                  ) : null}
                </p>
              </>
            )}
          </div>
```

- [ ] **Step 5: Replace the amount paragraph with a transfer-aware branch**

Find the amount `<p>` (around line 177, inside `{/* Amount + wallet badge */}`). Replace the existing `<p>` with this conditional. For transfers: neutral foreground, inline ArrowUp/ArrowDown before the number, no `+`/`−` sign. For non-transfers: unchanged behavior (red/green + sign).

```tsx
// before
            <p
              className={cn(
                "font-heading text-base font-semibold tabular-nums leading-tight",
                isIncome ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
              )}
            >
              {isIncome ? "+" : "-"}
              {formatCurrency(Number(row.amount), row.wallet.currency)}
            </p>
```

```tsx
// after
            <p
              className={cn(
                "font-heading text-base font-semibold tabular-nums leading-tight",
                isTransfer
                  ? "inline-flex items-center gap-1 text-foreground"
                  : isIncome
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-destructive",
              )}
            >
              {isTransfer ? (
                isOutgoing ? (
                  <ArrowUp aria-hidden className="size-3.5" weight="bold" />
                ) : (
                  <ArrowDown aria-hidden className="size-3.5" weight="bold" />
                )
              ) : (
                <>{isIncome ? "+" : "-"}</>
              )}
              {formatCurrency(Number(row.amount), row.wallet.currency)}
            </p>
```

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: passes. (`row.counterpartWallet` is now declared on `TransactionWithRefs` after Task 2; the booleans are local.)

If you see `Property 'counterpartWallet' does not exist on type 'TransactionWithRefs'`, Task 2 wasn't applied — go back and finish it.

- [ ] **Step 7: Lint**

Run: `pnpm lint`
Expected: passes.

- [ ] **Step 8: Commit**

```bash
git add components/transactions/transaction-row.tsx
git commit -m "$(cat <<'EOF'
feat(transactions): render transfer legs with directional arrows

Transfer legs no longer share the red expense styling. The row uses a
neutral gray icon circle with ArrowUp (outgoing) or ArrowDown
(incoming), names the counterpart wallet in the title slot, and shows
a sign-less amount in the foreground color with the matching arrow
inline before the number.

Expense/income rendering is untouched.
EOF
)"
```

---

## Task 4: Manual browser verification

**Files:** none modified (verification only).

The spec defines the acceptance criteria as a list of visual outcomes. Walk through each one in the browser to confirm. **Do not skip this** — the test runner doesn't exist, so manual verification is the only safety net before claiming completion.

- [ ] **Step 1: Start the dev server**

Run: `pnpm dev`
Wait until the terminal prints `▲ Next.js ... Ready in ...`. The default URL is `http://localhost:3000`.

- [ ] **Step 2: Verify expense rows are unchanged (regression check)**

Navigate to `http://localhost:3000/dashboard`. In the "Últimas transacciones" card, find any row with `type: "expense"` — anything with a colored category icon and a red `−$ ...` amount.

Expected: the row looks identical to before — colored circular icon, red destructive amount with leading `−`, wallet badge on the right.

If anything changed visually for a plain expense row, Task 3 introduced a regression in the non-transfer branch. Diff the file against `HEAD~1` and confirm the `else` branches in Steps 3–5 match the original markup exactly.

- [ ] **Step 3: Verify income rows are unchanged (regression check)**

Find or create an income row (use `/transactions/new`, pick a wallet, set type to "Ingreso", any amount, save). Return to `/dashboard`.

Expected: row shows green emerald amount with leading `+`, category icon (or fallback green-tinted circle), wallet badge.

- [ ] **Step 4: Verify the OUT leg of a transfer**

Find the OUT leg of an existing transfer (the row in the source wallet). The screenshot you started from had one — Mercadopago → ICBC for $180.000.

Expected, for the OUT row:
- Icon circle is **gray** (no category color), filled with an **up arrow** (↑).
- Title reads **"Transferencia a {destination wallet name}"** (e.g. "Transferencia a ICBC"), truncated if long.
- Subtitle is only the time (`HH:mm`), nothing else — no `· {wallet}` suffix.
- Amount is in **foreground color** (black/white per theme), preceded by a small up arrow, **no `+` or `−`** prefix.
- The wallet badge on the right still shows the row's own wallet (e.g. MERCADOPAGO).

- [ ] **Step 5: Verify the IN leg of the same transfer**

In the same list, find the matching IN leg (same `transfer_group_id`, opposite wallet — e.g. the row in ICBC).

Expected:
- Icon circle is gray with a **down arrow** (↓).
- Title reads **"Transferencia desde {source wallet}"** (e.g. "Transferencia desde Mercadopago").
- Subtitle is only the time.
- Amount is foreground color, preceded by a small down arrow, no `+`/`−`.
- Wallet badge shows the destination wallet (e.g. ICBC).

- [ ] **Step 6: Verify the same effect on `/transactions`**

Navigate to `http://localhost:3000/transactions`. Scroll to the transfer's day grouping. Both legs should render the same way as on the dashboard — confirming the change propagated through `TransactionList` automatically.

- [ ] **Step 7: Cross-currency transfer (if you have one)**

If your data includes a transfer with mismatched currencies (e.g., ARS → USD), find both legs.

Expected: each leg renders with **its own currency's amount and arrow** — there's no FX conversion display in this row, never was, and the spec doesn't ask for one. Both legs still get the gray icon and counterpart title.

If you have no cross-currency transfer, skip this step — it's not a blocker.

- [ ] **Step 8: Counterpart-wallet-deleted edge case**

This is rare. If your data contains a transfer whose counterpart wallet has been deleted (`counterpart_wallet_id` points to a nonexistent row), the PostgREST join returns `counterpartWallet: null`.

Expected: title falls back to the generic **"Transferencia"** (the existing `t.transaction.transfer` string), no crash, no `undefined` rendered. If you don't have such data, you can't verify this in the browser — trust the code (`row.counterpartWallet ? ... : t.transaction.transfer` in Step 4 of Task 3) and move on.

- [ ] **Step 9: Mobile-width sanity check**

Open Chrome DevTools, toggle device mode (Cmd+Shift+M), set the viewport to a narrow phone (e.g. iPhone SE, 375 × 667). Reload `/dashboard`.

Expected: nothing overflows. If a counterpart wallet has a long name, the title slot truncates with an ellipsis. The inline arrow next to the amount does **not** push the wallet badge off the right edge.

If the layout breaks on narrow viewports, the inline arrow's `size-3.5` may be too large — reduce to `size-3` or wrap the inline `<ArrowUp/Down>` in a tighter flex container. (Don't expect this — `size-3.5` is small and the row already uses `inline-flex items-center gap-1`.)

- [ ] **Step 10: Stop the dev server**

Press `Ctrl+C` in the terminal running `pnpm dev`.

- [ ] **Step 11: Optional — build check**

Run: `pnpm build`
Expected: completes without type errors. (This catches anything `pnpm typecheck` missed because of Next.js's stricter build-time validation, like server/client component boundaries — unlikely to fire here since we only edited a `"use client"` component and a server-only domain file, but cheap insurance.)

- [ ] **Step 12: No commit**

This task ships no code. If everything in Steps 2–11 looked correct, the feature is complete — Tasks 1–3 already produced the three commits that make up the change.

---

## Out of scope (do not implement)

The spec calls these out explicitly. Leave them alone:

- The 3-dot menu's "Eliminar" still tosses an error toast for transfer legs (`deleteTransaction` rejects with "No se puede borrar una transferencia aquí"). Pre-existing behavior — not a regression introduced by this change.
- The row's click target still routes to `/transactions/[id]`, which doesn't render transfer fields. Pre-existing.
- `TransferRow` in `components/transfers/transfer-row.tsx` (the standalone row on `/transferencias`) is untouched.

If you find yourself fixing either pre-existing bug "while you're in there," stop — those need their own spec and plan.
