# Telegram Agent — Design

**Status:** Draft for approval
**Date:** 2026-05-14
**Author:** nacho (with Claude)
**Owners:** single-user (nacho)

## Context

Today the Telegram bot at `lib/telegram/handlers/{text,photo,voice}.ts` calls three
single-purpose extractors in `lib/ai/extract-expense.ts`. Each extractor uses
`generateObject` with Gemini 2.5 Flash and a Zod schema (`ExpenseBatchExtractionSchema`)
to return structured JSON. There are **no AI tools**: the model only produces JSON,
and TypeScript code does all the business logic (resolve category, resolve wallet,
insert pending row, render preview, dedup, etc.). The flow always lands at a
preview-and-confirm UX (inline buttons), even when the input is unambiguous.

This design replaces the structured extractor with a **real tool-using agent** that
can decide what to do: create movements, read balances, search/update/delete
transactions, run ad-hoc analytics, or just reply in free text. Writes auto-execute;
a new `/deshacer` command rolls back the last write.

## Goals

- One central agent that owns AI decisions instead of three branching extractors.
- The agent picks the right tool from a CRUD + analytics surface.
- Writes execute immediately (no preview/confirm); `/deshacer` reverses the last one.
- When no tool fits, the agent can fall back to free-text reply, or as a last
  resort run a read-only SQL query against the user's own data.
- Stay on the $0/mes constraint: hosted Gemma 4 via Gemini API free tier (1500 RPD).

## Non-goals

- Voice notes (Gemma 4 hosted does not support audio; we drop the feature).
- Redo / multi-step undo / cascading undo of an agent turn.
- Web UI for the agent action log.
- Write access through the SQL escape hatch.
- Streaming responses to Telegram (Telegram API doesn't really stream; we send one
  message after the agent finishes).

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Model | `gemma-4-26b-a4b-it` via `@ai-sdk/google` | Free tier on Gemini API, text+image, native function calling. |
| Voice support | Removed | Gemma 4 hosted variants don't have audio; self-hosting E4B breaks $0/mes. |
| Tool scope | Full CRUD + analytics (10 tools) | Per user direction. |
| Write UX | Auto-execute + `/deshacer` | Per user direction. Faster than preview/confirm. |
| Escape hatch | `run_readonly_sql` (SELECT-only, RLS-enforced) | Per user direction. Read-only keeps damage bounded. |
| Update/delete target | By `id` only | Forces agent to search first. No fuzzy filter matching. |
| Undo granularity | Last single action | YAGNI on action-group rollback. User can repeat `/deshacer` for older entries. |
| Step limit | `stopWhen: stepCountIs(5)` | Caps cost per turn. |

## Architecture

### File layout

```
lib/ai/agent/
├── index.ts          // runExpenseAgent({ userId, text?, image?, chatId, supabase })
├── provider.ts       // gemma4 = google("gemma-4-26b-a4b-it")
├── prompts.ts        // system prompt + ARGENTINE_PAYEES + INTERNAL_TRANSFER_HINTS
├── tools/
│   ├── index.ts      // buildTools(ctx) -> tools record for generateText
│   ├── movements.ts  // create_movements, update_movement, delete_movement
│   ├── reads.ts      // get_balance, list_recent, list_wallets, list_categories,
│   │                 //   search_transactions, get_spend_by_category
│   └── escape.ts     // run_readonly_sql
└── action-log.ts     // logAction(), getLastReversibleAction(), reverseAction()
```

### Changes to existing code

| File | Change |
|---|---|
| `lib/telegram/handlers/text.ts` | Adelgazar: call `runExpenseAgent({ text })`, send reply. |
| `lib/telegram/handlers/photo.ts` | Adelgazar: upload to storage, call `runExpenseAgent({ text: caption, image })`, send reply. |
| `lib/telegram/handlers/voice.ts` | Replace body with a polite notice: `"Voice deshabilitado. Mandame el gasto por texto o sacale una foto al ticket."` Keep the file so unhandled voice messages don't fall to the catch-all. |
| `lib/telegram/handlers/index.ts` | Unregister voice; register `/deshacer` handler. |
| `lib/telegram/handlers/undo.ts` | **New.** `/deshacer` command. |
| `lib/ai/extract-expense.ts` | Delete after Step 7. Logic moves into `tools/movements.ts`. |
| `lib/ai/provider.ts` | Move into `lib/ai/agent/provider.ts`. |
| `lib/ai/schemas.ts` | Keep `ExpenseItemSchema` (used inside `create_movements`). Drop batch wrapper if no other caller. |

### Not touched

- `handlers/status.ts` (`/saldo`, `/ultimos`) — deterministic, no AI.
- `handlers/start.ts` — linking flow.
- `handlers/batch.ts`, `handlers/confirm.ts`, `pending-batch.ts`,
  `preview-batch.ts` — kept during migration as **dead code** (no longer invoked
  after Step 4). Removing them is a follow-up PR outside this spec's scope so
  this PR stays surgical.
- `category-resolver.ts`, `wallet-resolver.ts`, `dedup.ts`, `storage-helpers.ts`,
  `get-linked-user.ts` — reused inside tool implementations.

## Data model

### New table

```sql
create table public.telegram_agent_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  telegram_chat_id bigint not null,
  action_type text not null check (action_type in ('create','update','delete')),
  target_table text not null default 'transactions',
  target_ids uuid[] not null,
  before_payload jsonb,
  after_payload jsonb,
  agent_summary text,
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by_action_id uuid references public.telegram_agent_actions(id)
);

create index on public.telegram_agent_actions (user_id, created_at desc)
  where reversed_at is null;

alter table public.telegram_agent_actions enable row level security;
create policy "users see own agent actions"
  on public.telegram_agent_actions for select
  using (auth.uid() = user_id);
```

| Field | Purpose |
|---|---|
| `target_ids` | UUIDs of affected `transactions` rows. |
| `before_payload` | Full row snapshot for update/delete. Null for create. |
| `after_payload` | Full row snapshot for create/update. Null for delete. |
| `agent_summary` | Human-readable string ("creó 3 movimientos") for the `/deshacer` confirmation reply. |
| `reversed_at` | Set when `/deshacer` succeeds. Null = still reversible. |
| `reversed_by_action_id` | Self-reference for traceability (which `/deshacer` action reversed this one). |

### New RPC for the SQL escape hatch

```sql
create or replace function public.agent_readonly_query(p_sql text)
returns jsonb
language plpgsql
security invoker
as $$
declare
  result jsonb;
begin
  -- Block multi-statement and DDL/DML in SQL itself (defense in depth; TS
  -- validates first, but the RPC must not trust its caller).
  if p_sql ~* '\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|EXECUTE|CALL|MERGE|REPLACE|VACUUM|REINDEX)\b' then
    raise exception 'agent_readonly_query: forbidden keyword';
  end if;
  if p_sql ~ ';\s*\S' then
    raise exception 'agent_readonly_query: multiple statements not allowed';
  end if;
  if p_sql !~* '^\s*(WITH|SELECT)\s' then
    raise exception 'agent_readonly_query: must start with SELECT or WITH';
  end if;

  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (%s) as t', p_sql) into result;
  return result;
end;
$$;
```

`SECURITY INVOKER` keeps RLS enforced under the caller's JWT. The agent calls this
RPC with a Supabase client authenticated as the linked user — not the service role.

## Tool catalog

| # | Tool | Type | Input | Returns | Logged to action log |
|---|---|---|---|---|---|
| 1 | `create_movements` | write | `{ items: ExpenseItem[], wallet_id: uuid, photo_path?: string }` | `{ created_count, ids, dedup_warnings }` | Yes (`action_type='create'`, `after_payload`=inserted rows) |
| 2 | `update_movement` | write | `{ id: uuid, patch: Partial<{amount, currency, payee, description, category_id, occurred_at, wallet_id, type}> }` | Updated row | Yes (`update`, `before_payload`=row before, `after_payload`=row after) |
| 3 | `delete_movement` | write | `{ id: uuid }` | `{ deleted: true }` | Yes (`delete`, `before_payload`=full row) |
| 4 | `get_balance` | read | `{ wallet_id?: uuid }` | Balance per wallet or total in `main_currency` | No |
| 5 | `list_recent` | read | `{ limit?: 1-20, type?, wallet_id? }` | Rows ordered by `occurred_at desc` | No |
| 6 | `list_wallets` | read | `{ include_archived?: boolean }` | User's wallets | No |
| 7 | `list_categories` | read | `{ type?: 'expense'\|'income' }` | User's categories | No |
| 8 | `search_transactions` | read | `{ query?, date_from?, date_to?, type?, wallet_id?, category_id?, limit?: 1-50 }` | Matching rows (ILIKE on description+payee) | No |
| 9 | `get_spend_by_category` | read | `{ date_from, date_to, type? }` | Aggregated `[{ category_id, category_name, total, count }]` | No |
| 10 | `run_readonly_sql` | escape | `{ sql: string, why: string }` | Rows from the validated SELECT | No |

### Validation rules

- All write tools insert/update/delete in `transactions`. They use the same helpers
  the current handlers use (`resolveCategory`, `resolveWalletFromCaption`,
  `deduplicateBatch`) so business logic stays consistent.
- `create_movements` runs dedup before inserting and skips items already present
  (returning them in `dedup_warnings`).
- `update_movement` / `delete_movement` require `id` — the agent is prompted to
  call `search_transactions` or `list_recent` first.
- `run_readonly_sql` validation in TypeScript (`lib/ai/agent/tools/escape.ts`):
  - Must start with `SELECT` or `WITH`.
  - No `INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|EXECUTE|CALL|MERGE|REPLACE|VACUUM|REINDEX`.
  - No multiple statements (regex on `;\s*\S`).
  - Auto-inject `LIMIT 100` if absent.
  - Calls `public.agent_readonly_query(p_sql)` (defense-in-depth: same checks in SQL).
  - `why` field is required and logged to `console.info` for audit.

## Agent loop

```ts
generateText({
  model: gemma4,
  system: buildSystemPrompt(user),
  messages: [{ role: "user", content: [textPart?, imagePart?] }],
  tools: buildTools(ctx),
  stopWhen: stepCountIs(5),
  toolChoice: "auto",
  temperature: 0,
});
```

- `maxSteps`/`stopWhen` of 5 prevents runaway cost.
- `temperature: 0` for stability.
- After the call, the agent's final text response is sent to the user via
  `ctx.reply`. If after 5 steps there is no text response, send a generic fallback.

## System prompt

Lives at `lib/ai/agent/prompts.ts`. Sections:

1. **Identity:** Spanish (rioplatense), concise, financial assistant.
2. **Routing rules:**
   - Describes a gasto/ingreso/transferencia → `create_movements`.
   - Asks about own data (saldo, últimos, qué gasté en X) → appropriate read tool.
   - Asks to modify/delete → search first, then update/delete by id.
   - Ambiguous (e.g., wallet name matches two) → reply with text asking for
     clarification, do NOT call a tool.
   - Nothing matches but it's an analytics query → `run_readonly_sql` with `why`.
3. **Auto-execute disclosure:** writes happen immediately; if unsure, prefer to
   ask first via text. User can `/deshacer`.
4. **Argentine payee normalization** (current `ARGENTINE_PAYEES` block).
5. **Internal transfer hints** (current `INTERNAL_TRANSFER_HINTS` block).
6. **Context:** `Default currency: <user.main_currency>. Today: <ISO + Buenos Aires year>.`

## Data flow

### Text or photo message

1. Telegram webhook → `handlers/text.ts` (or `photo.ts`).
2. Handler resolves linked user, downloads input (photo: also uploads to storage).
3. Handler calls `runExpenseAgent({ userId, text, image?, chatId, supabase })`.
4. Agent loop runs (up to 5 steps).
5. Each tool call:
   - Read tools query DB with the user-scoped client.
   - Write tools execute, then `logAction(...)` writes a row to
     `telegram_agent_actions`.
   - `run_readonly_sql` validates → calls RPC → returns rows.
6. Final text response sent via `ctx.reply`.

### `/deshacer` command

1. `handlers/undo.ts` resolves linked user.
2. `getLastReversibleAction(user_id)` → top row with `reversed_at IS NULL`.
3. If none: reply `"No hay nada para deshacer."`.
4. Reverse per `action_type`:
   - `create`: `DELETE FROM transactions WHERE id = ANY(target_ids)`.
   - `update`: restore `before_payload` via UPDATE.
   - `delete`: re-INSERT preserving id from `before_payload`.
5. In a transactional RPC, also `UPDATE telegram_agent_actions SET reversed_at = now()
   WHERE id = $1 AND reversed_at IS NULL`. If 0 rows affected → race; reply
   `"Ya estaba deshecho."`.
6. On success: `"↩️ Deshecho: <agent_summary> → revertido."`.

## Error handling

| Layer | Failure | Behavior |
|---|---|---|
| Tool execution | throws | Caught by AI SDK, returned as `{error: msg}` so the model can react. |
| Model | 429 quota exceeded | Reply: `"Mi cuota AI llegó al límite de hoy. Probá mañana o usá /saldo y /ultimos."` |
| Model | other error | Log + `"Algo falló procesando tu mensaje. Probá de nuevo."` |
| Step limit | 5 steps without final text | Reply generic fallback. |
| Image | rejected by Gemma | Same generic error. |
| `/deshacer` | nothing to undo | `"No hay nada para deshacer."` |
| `/deshacer` | reverse fails (e.g., row deleted manually since) | `"No pude deshacer: la transacción ya no existe o cambió desde entonces."` (do NOT mark reversed_at). |

## Observability

- `console.info` per tool call: `{ step, tool_name, args_summary, user_id, ms_elapsed }`.
- `run_readonly_sql` additionally logs `why` and a short SQL hash for audit.
- Existing `bot.catch` keeps logging top-level handler errors.

## Migration plan

Each step is a separate commit (preferably a separate PR). Reverts are trivial
through git.

| Step | What | Risk |
|---|---|---|
| 1 | `supabase/migrations/00XX_agent_actions.sql` — table + RLS + RPC | Additive; no risk. |
| 2 | Build `lib/ai/agent/` module standalone (no callers wired). | Unit tests run; no behavior change. |
| 3 | Wire `handlers/text.ts` to `runExpenseAgent`. | Text path now goes through the agent. Test in dev with real bot. |
| 4 | Wire `handlers/photo.ts` to `runExpenseAgent`. | Photo path through agent. |
| 5 | Replace `handlers/voice.ts` body with the "voice deshabilitado" notice. | Voice users get a clear message instead of silence. |
| 6 | Add `/deshacer` command. | New command; doesn't affect anything else. |
| 7 | Delete `lib/ai/extract-expense.ts`, move `lib/ai/provider.ts` into agent module, prune `lib/ai/schemas.ts`. | Cleanup; only safe after Steps 3 + 4 are validated. |

No feature flag. If something regresses, we revert the last step. Cleaner than
maintaining two codepaths behind an env var.

## Testing

| Layer | What | How |
|---|---|---|
| Each tool | Happy path + one error path | Vitest with Supabase client mock. |
| Action log + `/deshacer` | create→undo, update→undo, delete→undo, concurrent undo | Vitest against local `supabase start` instance. |
| Escape hatch validator | valid SELECT, CTE-with-INSERT (must reject), DROP, multiple statements | Vitest unit, no DB. |
| `runExpenseAgent` | Builds the call correctly, respects `maxSteps`, formats response | Vitest with `generateText` mock returning canned tool calls. |
| Handlers | Pass correct input, send correct reply | Vitest with grammY context mock. |
| Bot E2E | Real dev bot | Manual: text expense, photo ticket, screenshot wallet feed, query "cuánto gasté en comida en abril", "/deshacer", "/deshacer" with nothing to undo. |

If Vitest is not yet configured in the repo, it gets added during Step 2.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Model hallucinates an id for update/delete | Prompt requires `search_transactions`/`list_recent` first. Update against a non-existent id is a no-op. |
| Gemma quota (1500 RPD) exhausted mid-day | `/saldo`, `/ultimos`, `/deshacer` stay deterministic and keep working. |
| Image token cost | Telegram photos are small; budget ~256-512 tokens/image. 1500 RPD has headroom. |
| Runaway tool-call loop | `stopWhen: stepCountIs(5)` + generic fallback. |
| RLS misconfigured on escape hatch RPC | `SECURITY INVOKER` + RPC tests with a dummy user trying to read another user's data. |
| Race on `/deshacer` | `UPDATE … WHERE reversed_at IS NULL` returns rows affected; 0 = already reversed. |
| Model picks `run_readonly_sql` unnecessarily | Prompt frames it as last resort and requires `why`. Logged for audit. |

## Open questions

None at design approval time. Anything that surfaces during implementation will
be folded into the implementation plan, not this spec.
