# Telegram Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the structured extractor (`lib/ai/extract-expense.ts`) with a tool-using agent on Gemma 4 that owns AI decisions for the Telegram bot, supports auto-execute writes with a `/deshacer` rollback, and has a read-only SQL escape hatch.

**Architecture:** New module `lib/ai/agent/` exposes `runExpenseAgent({ userId, text?, image?, chatId, supabase })`. Handlers `text.ts` and `photo.ts` become thin shells that call it. Writes go directly to `transactions` and log to a new `telegram_agent_actions` table; `/deshacer` reverses the last unreverted action. The SQL escape hatch calls a Postgres RPC that validates SELECT-only and uses parameterized `$1` substitution for the user_id (deviation from spec's RLS-scoped client — see Design Adjustments below).

**Tech Stack:** Next.js 16, TypeScript, Supabase Postgres, `@ai-sdk/google` (Gemma 4 via Gemini API), `ai` (Vercel AI SDK v6), `grammy`, `zod`, `vitest` (new).

---

## Spec Reference

This plan implements `docs/superpowers/specs/2026-05-14-telegram-agent-design.md`.

## Design Adjustments from Spec

| Spec said | Plan does | Why |
|---|---|---|
| SQL escape hatch uses an RLS-scoped user client | SQL escape hatch uses service role + Postgres RPC with `$1` parameter binding for `user_id` | The codebase has no user-scoped client utility (Telegram path always uses `createAdminClient()`). Building a JWT-minting helper is out of scope; parameterized binding gives equivalent security with no architectural change. |
| Migration filename `00XX_agent_actions.sql` | `0012_agent_actions.sql` | Next free migration number per `supabase/migrations/`. |

## Pre-Task: Branch Hygiene

The spec was committed to `wave-6/quick-category-edit` (60130d1). Before starting implementation, move it to a dedicated branch:

```bash
# From wave-6/quick-category-edit, with 60130d1 as the spec commit:
git checkout -b wave-6/telegram-agent 60130d1
git checkout wave-6/quick-category-edit
git reset --hard HEAD~1   # remove the spec commit from this branch
git checkout wave-6/telegram-agent
```

If you don't want to clean `wave-6/quick-category-edit`, at minimum start `wave-6/telegram-agent` from `60130d1` so the new work has the spec in its history.

---

## File Structure

### Files to create

- `supabase/migrations/0012_agent_actions.sql` — table `telegram_agent_actions`, RLS policy, RPC `agent_readonly_query(text, uuid)`.
- `lib/ai/agent/provider.ts` — `gemma4 = google("gemma-4-26b-a4b-it")` + `requireGoogleAi()` guard.
- `lib/ai/agent/prompts.ts` — `buildSystemPrompt({ mainCurrency, todayIso, todayYear })` returning the full system prompt text.
- `lib/ai/agent/action-log.ts` — `logAction()`, `getLastReversibleAction()`, `reverseAction()`.
- `lib/ai/agent/tools/movements.ts` — `create_movements`, `update_movement`, `delete_movement` tool definitions.
- `lib/ai/agent/tools/reads.ts` — `get_balance`, `list_recent`, `list_wallets`, `list_categories`, `search_transactions`, `get_spend_by_category`.
- `lib/ai/agent/tools/escape.ts` — `run_readonly_sql` + `validateSelectOnly()` + `withLimit()`.
- `lib/ai/agent/tools/index.ts` — `buildTools(ctx)` aggregator.
- `lib/ai/agent/index.ts` — `runExpenseAgent({ userId, text?, image?, chatId, supabase, mainCurrency })`.
- `lib/telegram/handlers/undo.ts` — `/deshacer` command handler.
- `vitest.config.ts` — Vitest config.
- Test files per module: `tests/ai/agent/*.test.ts`.

### Files to modify

- `lib/telegram/handlers/text.ts` — replace AI extraction with `runExpenseAgent`.
- `lib/telegram/handlers/photo.ts` — replace AI extraction with `runExpenseAgent`.
- `lib/telegram/handlers/voice.ts` — replace body with "voice deshabilitado" notice.
- `lib/telegram/handlers/index.ts` — register `/deshacer`.
- `package.json` — add `vitest`, `@vitest/expect`, `vitest` script.

### Files to delete (in cleanup task)

- `lib/ai/extract-expense.ts`
- `lib/ai/provider.ts` (logic moves to `lib/ai/agent/provider.ts`)

### Files kept dead (out of scope for cleanup)

- `lib/telegram/handlers/batch.ts`, `lib/telegram/handlers/confirm.ts`, `lib/telegram/pending-batch.ts`, `lib/telegram/preview-batch.ts` — dead after Task 16 wiring; deletion is a separate follow-up PR.

---

## Task 1: Create the `0012_agent_actions.sql` migration

**Files:**
- Create: `supabase/migrations/0012_agent_actions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0012_agent_actions.sql
-- Audit log for writes performed by the Telegram agent + RPC for the
-- read-only SQL escape hatch.

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

create index telegram_agent_actions_user_reversible_idx
  on public.telegram_agent_actions (user_id, created_at desc)
  where reversed_at is null;

alter table public.telegram_agent_actions enable row level security;

create policy "users see own agent actions"
  on public.telegram_agent_actions
  for select
  using (auth.uid() = user_id);

-- Read-only SQL escape hatch. Caller must pass user_id explicitly; the SQL
-- itself must reference $1 as the user_id placeholder. We parse the SQL for
-- forbidden keywords as a second line of defense (the TS layer validates
-- first; the RPC must not trust its caller).
create or replace function public.agent_readonly_query(p_sql text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if p_sql is null or length(trim(p_sql)) = 0 then
    raise exception 'agent_readonly_query: empty sql';
  end if;
  if p_sql ~* '\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|EXECUTE|CALL|MERGE|REPLACE|VACUUM|REINDEX)\b' then
    raise exception 'agent_readonly_query: forbidden keyword';
  end if;
  if p_sql ~ ';\s*\S' then
    raise exception 'agent_readonly_query: multiple statements not allowed';
  end if;
  if p_sql !~* '^\s*(WITH|SELECT)\s' then
    raise exception 'agent_readonly_query: must start with SELECT or WITH';
  end if;
  if position('$1' in p_sql) = 0 then
    raise exception 'agent_readonly_query: sql must reference $1 for user_id';
  end if;

  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (%s) as t', p_sql)
    using p_user_id
    into result;
  return result;
end;
$$;

revoke all on function public.agent_readonly_query(text, uuid) from public;
grant execute on function public.agent_readonly_query(text, uuid) to service_role;
```

- [ ] **Step 2: Apply locally**

Run: `supabase db reset`
Expected: migration applies cleanly; no errors.

- [ ] **Step 3: Smoke-test the RPC**

Run:
```bash
supabase db query "select public.agent_readonly_query('select 1 as one where \$1 = \$1', '00000000-0000-0000-0000-000000000000'::uuid);"
```
Expected: `[{"one": 1}]`

Then try a forbidden one:
```bash
supabase db query "select public.agent_readonly_query('select * from transactions', '00000000-0000-0000-0000-000000000000'::uuid);"
```
Expected: ERROR: `agent_readonly_query: sql must reference $1 for user_id`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0012_agent_actions.sql
git commit -m "feat(db): agent action log + readonly query RPC"
```

---

## Task 2: Install Vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install Vitest**

Run: `pnpm add -D vitest @vitest/expect`
Expected: dependencies added.

- [ ] **Step 2: Add `test` script to `package.json`**

Modify the `scripts` block of `package.json`:

```json
{
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "format": "prettier --write \"**/*.{ts,tsx}\"",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

- [ ] **Step 4: Verify a trivial test passes**

Create `tests/sanity.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("sanity", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `pnpm test`
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts tests/sanity.test.ts
git commit -m "chore(test): add vitest + sanity test"
```

---

## Task 3: Agent provider module

**Files:**
- Create: `lib/ai/agent/provider.ts`

- [ ] **Step 1: Write the provider**

```ts
// lib/ai/agent/provider.ts
import { google } from "@ai-sdk/google";

/**
 * Gemma 4 (26B MoE, 4B active) via the Gemini API. Text + image only; the
 * hosted Gemma variants do not support audio. Free tier is 1500 RPD.
 *
 * Reads `GOOGLE_GENERATIVE_AI_API_KEY` from env automatically.
 */
export const gemma4 = google("gemma-4-26b-a4b-it");

export function requireGoogleAi(): void {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error(
      "GOOGLE_GENERATIVE_AI_API_KEY is not set. Add it to .env.local before calling the agent.",
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ai/agent/provider.ts
git commit -m "feat(ai): agent provider on gemma-4-26b-a4b-it"
```

---

## Task 4: System prompt

**Files:**
- Create: `lib/ai/agent/prompts.ts`

- [ ] **Step 1: Write the prompt builder**

```ts
// lib/ai/agent/prompts.ts
//
// System prompt for the Telegram expense agent. The Argentine payee
// normalization and internal-transfer hint blocks are copied verbatim from
// the previous extractor (lib/ai/extract-expense.ts) so behavior is
// preserved.

const INTERNAL_TRANSFER_HINTS = [
  "DEBIN",
  "TRANSFERENCIA PUSH",
  "CREDITO INMEDIATO",
  "DEB PREA",
  "PAGO PERSONAL",
  "TRANSFERENCIA RECIBIDA",
  "TRANSFERENCIA ENVIADA",
  "INGRESO DE DINERO",
];

const ARGENTINE_PAYEES = `
- CPA. PEDIDOSYA *      → payee="PedidosYa", category="comida", subcategory="comida rápida"
- CPA. MAKRO *          → payee="Makro", category="comida", subcategory="supermercado"
- CPA. COTO *           → payee="Coto", category="comida", subcategory="supermercado"
- CPA. CARREFOUR *      → payee="Carrefour", category="comida", subcategory="supermercado"
- CPA. DISCO *          → payee="Disco", category="comida", subcategory="supermercado"
- CPA. EDENOR* / EDESUR*  → payee="<empresa>", category="servicios"
- CPA. TELECOM* / MOVISTAR* / PERSONAL* / CLARO*  → payee="<empresa>", category="servicios"
- CPA. METROGAS* / NATURGY*  → payee="<empresa>", category="servicios"
- CPA. AYSA*            → payee="AySA", category="servicios"
- CPA. APPLE.COM/BILL / SPOTIFY* / NETFLIX* / DISNEY* / HBO* → payee="<empresa>", category="entretenimiento"
- CPA. UBER* / CABIFY*  → payee="<empresa>", category="transporte"
- CPA. SUBE*            → payee="SUBE", category="transporte"
- CPA. CLUB LA NACION   → payee="Club La Nación", category="entretenimiento"
- CPA. ABL *            → payee="ABL (rentas CABA)", category="hogar"
- CPA. BOOT.DEV / UDEMY* → category="educacion"
- IVA SERV DIG EXT      → payee="AFIP - IVA", category="otros"
- PERCEPCION TD RG 4815/20 → payee="AFIP - percepción", category="otros"
- PERCEPCION IIBB       → payee="IIBB - percepción", category="otros"
`;

export interface PromptContext {
  mainCurrency: string;
  todayIso: string;
  todayYearAr: string;
}

export function currentDateContext(): PromptContext {
  const now = new Date();
  const yearAr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  })
    .format(now)
    .slice(0, 4);
  return {
    mainCurrency: "ARS",
    todayIso: now.toISOString(),
    todayYearAr: yearAr,
  };
}

export function buildSystemPrompt(ctx: PromptContext): string {
  return [
    "Sos el asistente financiero personal de un usuario argentino. Hablás español rioplatense (Argentina), sos conciso y accionable.",
    "Recibís texto y/o imágenes desde Telegram. Tu tarea es entender qué quiere el usuario y elegir la tool correcta.",
    "",
    "REGLAS:",
    "- Si el usuario describe un gasto/ingreso/transferencia (texto, foto de ticket, screenshot bancario o feed de billetera): usá `create_movements`. Extraé TODOS los movimientos visibles, no inventes filas.",
    "- Si pregunta sobre sus datos (saldo, últimos, qué gastó en X, total por categoría): usá la tool de read apropiada (`get_balance`, `list_recent`, `search_transactions`, `get_spend_by_category`).",
    "- Si pide modificar o borrar: primero buscá el id con `search_transactions` o `list_recent`, después usá `update_movement` o `delete_movement`.",
    "- Si necesitás aclaración (ej: wallet ambigua, dos coincidencias): NO llames tool — respondé con texto pidiendo aclaración.",
    "- Si nada matchea pero parece query analítica sobre los datos del usuario, usá `run_readonly_sql` como último recurso. El SQL DEBE referenciar $1 como placeholder para el user_id. Justificá en el campo `why`.",
    "",
    "WRITES son auto-execute: ejecutás directo, no preguntás 'querés confirmar'. Si dudás, mejor preguntá antes via texto (no llames tool). El usuario puede `/deshacer` siempre.",
    "",
    "NORMALIZACIÓN DE PAYEES ARGENTINOS:",
    ARGENTINE_PAYEES.trim(),
    "Si no matchea ningún payee conocido: limpiá prefijos (CPA., DEB, números) y dejá el resto como payee.",
    "",
    "TRANSFER_HINT: marcalo true SOLO si el concepto contiene alguno de estos patrones (case-insensitive, accent-insensitive); cualquier otro caso, false:",
    INTERNAL_TRANSFER_HINTS.map((h) => `  - ${h}`).join("\n"),
    "",
    `Default currency: ${ctx.mainCurrency}. Today (UTC ISO): ${ctx.todayIso}. Current year in Argentina: ${ctx.todayYearAr}.`,
  ].join("\n");
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ai/agent/prompts.ts
git commit -m "feat(ai): agent system prompt"
```

---

## Task 5: Action log helpers + tests

**Files:**
- Create: `lib/ai/agent/action-log.ts`
- Create: `tests/ai/agent/action-log.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/ai/agent/action-log.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import { logAction } from "@/lib/ai/agent/action-log";

function makeMockClient() {
  const insert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi
        .fn()
        .mockResolvedValue({ data: { id: "act-1" }, error: null }),
    }),
  });
  const from = vi.fn().mockReturnValue({ insert });
  return { from, _insert: insert };
}

describe("logAction", () => {
  let mock: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    mock = makeMockClient();
  });

  it("writes a create-type row with after_payload", async () => {
    const id = await logAction(mock as never, {
      userId: "user-1",
      chatId: 123,
      actionType: "create",
      targetIds: ["tx-1", "tx-2"],
      beforePayload: null,
      afterPayload: [{ id: "tx-1" }, { id: "tx-2" }],
      agentSummary: "creó 2 movimientos",
    });
    expect(id).toBe("act-1");
    expect(mock.from).toHaveBeenCalledWith("telegram_agent_actions");
    expect(mock._insert).toHaveBeenCalledWith({
      user_id: "user-1",
      telegram_chat_id: 123,
      action_type: "create",
      target_table: "transactions",
      target_ids: ["tx-1", "tx-2"],
      before_payload: null,
      after_payload: [{ id: "tx-1" }, { id: "tx-2" }],
      agent_summary: "creó 2 movimientos",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/ai/agent/action-log.test.ts`
Expected: FAIL with "cannot find module '@/lib/ai/agent/action-log'".

- [ ] **Step 3: Implement `action-log.ts`**

```ts
// lib/ai/agent/action-log.ts
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

type AdminClient = SupabaseClient<Database>;

export type ActionType = "create" | "update" | "delete";

export interface LogActionInput {
  userId: string;
  chatId: number;
  actionType: ActionType;
  targetIds: string[];
  beforePayload: unknown;
  afterPayload: unknown;
  agentSummary: string;
}

export async function logAction(
  supabase: AdminClient,
  input: LogActionInput,
): Promise<string> {
  const { data, error } = await supabase
    .from("telegram_agent_actions")
    .insert({
      user_id: input.userId,
      telegram_chat_id: input.chatId,
      action_type: input.actionType,
      target_table: "transactions",
      target_ids: input.targetIds,
      before_payload: input.beforePayload as never,
      after_payload: input.afterPayload as never,
      agent_summary: input.agentSummary,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`logAction failed: ${error?.message ?? "no row returned"}`);
  }
  return data.id;
}

export interface ReversibleAction {
  id: string;
  action_type: ActionType;
  target_ids: string[];
  before_payload: unknown;
  after_payload: unknown;
  agent_summary: string | null;
}

export async function getLastReversibleAction(
  supabase: AdminClient,
  userId: string,
): Promise<ReversibleAction | null> {
  const { data, error } = await supabase
    .from("telegram_agent_actions")
    .select("id, action_type, target_ids, before_payload, after_payload, agent_summary")
    .eq("user_id", userId)
    .is("reversed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`getLastReversibleAction failed: ${error.message}`);
  }
  if (!data) return null;
  return data as ReversibleAction;
}

/**
 * Marks an action as reversed atomically. Returns `true` if THIS call did the
 * marking; `false` if another concurrent call beat us (so the caller should
 * report "ya estaba deshecho" instead of running the reversal again).
 */
export async function markReversed(
  supabase: AdminClient,
  actionId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("telegram_agent_actions")
    .update({ reversed_at: new Date().toISOString() })
    .eq("id", actionId)
    .is("reversed_at", null)
    .select("id");
  if (error) {
    throw new Error(`markReversed failed: ${error.message}`);
  }
  return (data?.length ?? 0) > 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/ai/agent/action-log.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/agent/action-log.ts tests/ai/agent/action-log.test.ts
git commit -m "feat(ai): action log helpers"
```

---

## Task 6: `create_movements` tool

**Files:**
- Create: `lib/ai/agent/tools/movements.ts`
- Create: `tests/ai/agent/tools/movements.test.ts`

This task implements ONLY `create_movements`. Tasks 7 and 8 add `update_movement` and `delete_movement` respectively.

- [ ] **Step 1: Write the failing test**

```ts
// tests/ai/agent/tools/movements.test.ts
import { describe, expect, it, vi } from "vitest";

import { createMovementsTool } from "@/lib/ai/agent/tools/movements";

function makeCtx() {
  const inserted = [
    {
      id: "tx-1",
      user_id: "u",
      wallet_id: "w",
      amount: 200,
      currency: "ARS",
      type: "expense",
      occurred_at: "2026-05-14T15:00:00Z",
      category_id: "cat-comida",
      payee: "Café",
      description: null,
      photo_path: null,
      source: "telegram_text",
    },
  ];
  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "transactions") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({ data: inserted, error: null }),
          }),
        };
      }
      if (table === "telegram_agent_actions") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi
                .fn()
                .mockResolvedValue({ data: { id: "act-1" }, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
  return {
    supabase: supabase as never,
    userId: "u",
    chatId: 123,
    mainCurrency: "ARS",
    resolveCategory: vi.fn(async () => ({ id: "cat-comida", label: "Comida" })),
    dedupBatch: vi.fn(async () => [
      { batch_index: 0, is_duplicate: false, duplicate_of_tx_id: null },
    ]),
  };
}

describe("create_movements", () => {
  it("inserts non-duplicate items and returns ids", async () => {
    const ctx = makeCtx();
    const tool = createMovementsTool(ctx);
    const result = await tool.execute({
      items: [
        {
          type: "expense",
          amount: 200,
          currency: "ARS",
          payee: "Café",
          description: null,
          category_hint: "comida",
          subcategory_hint: "café",
          occurred_at: "2026-05-14T15:00:00Z",
          transfer_hint: false,
          external_id: null,
          confidence: 0.95,
        },
      ],
      wallet_id: "w",
    });
    expect(result.created_count).toBe(1);
    expect(result.ids).toEqual(["tx-1"]);
    expect(result.dedup_warnings).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/ai/agent/tools/movements.test.ts`
Expected: FAIL with "cannot find module".

- [ ] **Step 3: Implement `createMovementsTool`**

```ts
// lib/ai/agent/tools/movements.ts
import { tool } from "ai";
import { z } from "zod";

import { logAction } from "@/lib/ai/agent/action-log";
import { ExpenseItemSchema } from "@/lib/ai/schemas";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

type AdminClient = SupabaseClient<Database>;

export interface MovementsCtx {
  supabase: AdminClient;
  userId: string;
  chatId: number;
  mainCurrency: string;
  /** Override for tests; defaults to the real resolveCategory at runtime. */
  resolveCategory?: (
    type: "expense" | "income",
    hint: string | null,
    subHint?: string | null,
  ) => Promise<{ id: string | null; label: string }>;
  /** Override for tests; defaults to the real deduplicateBatch at runtime. */
  dedupBatch?: (
    walletId: string,
    items: z.infer<typeof ExpenseItemSchema>[],
  ) => Promise<{ batch_index: number; is_duplicate: boolean; duplicate_of_tx_id: string | null }[]>;
}

const CreateInput = z.object({
  items: z.array(ExpenseItemSchema).min(1).max(100),
  wallet_id: z.string().uuid(),
  photo_path: z.string().nullable().optional(),
});

interface CreateResult {
  created_count: number;
  ids: string[];
  dedup_warnings: { index: number; duplicate_of_tx_id: string | null }[];
}

export function createMovementsTool(ctx: MovementsCtx) {
  return tool({
    description:
      "Crea uno o más movimientos (gastos / ingresos / transferencias) en la wallet indicada. Llamala cuando el usuario describe un gasto, ingreso, o cuando una imagen muestra movimientos (ticket, screenshot de homebanking, feed de billetera).",
    inputSchema: CreateInput,
    execute: async (input): Promise<CreateResult> => {
      const items = input.items.filter(
        (i) =>
          i.type !== "unknown" &&
          i.amount !== null &&
          i.amount > 0 &&
          i.confidence >= 0.4,
      );
      if (items.length === 0) {
        return { created_count: 0, ids: [], dedup_warnings: [] };
      }

      // Resolve categories.
      const resolveCategory =
        ctx.resolveCategory ??
        (async (
          type: "expense" | "income",
          hint: string | null,
          subHint?: string | null,
        ) => {
          const mod = await import("@/lib/telegram/category-resolver");
          return mod.resolveCategory(
            ctx.supabase,
            ctx.userId,
            type,
            hint,
            subHint,
          );
        });

      const withCats = await Promise.all(
        items.map(async (item) => {
          const cat = await resolveCategory(
            item.type === "income" ? "income" : "expense",
            item.category_hint,
            item.subcategory_hint,
          );
          return { item, categoryId: cat.id };
        }),
      );

      // Dedup pass.
      const dedupBatch =
        ctx.dedupBatch ??
        (async (walletId, dItems) => {
          const mod = await import("@/lib/telegram/dedup");
          return mod.deduplicateBatch(
            ctx.supabase,
            ctx.userId,
            walletId,
            dItems,
            "00000000-0000-0000-0000-000000000000",
          );
        });
      const dedup = await dedupBatch(input.wallet_id, items);
      const dupIndices = new Set(
        dedup.filter((d) => d.is_duplicate).map((d) => d.batch_index),
      );

      const toInsert = withCats
        .map((entry, idx) => ({ ...entry, idx }))
        .filter(({ idx }) => !dupIndices.has(idx));

      if (toInsert.length === 0) {
        return {
          created_count: 0,
          ids: [],
          dedup_warnings: dedup
            .filter((d) => d.is_duplicate)
            .map((d) => ({ index: d.batch_index, duplicate_of_tx_id: d.duplicate_of_tx_id })),
        };
      }

      const sourceMap: Record<string, Database["public"]["Enums"]["tx_source"]> = {
        text: "telegram_text",
        image: "telegram_photo",
      };
      const source = input.photo_path ? sourceMap.image : sourceMap.text;

      const rows = toInsert.map(({ item, categoryId }) => ({
        user_id: ctx.userId,
        wallet_id: input.wallet_id,
        category_id: categoryId,
        type: item.type as Database["public"]["Enums"]["tx_type"],
        amount: item.amount as number,
        currency: item.currency ?? ctx.mainCurrency,
        payee: item.payee,
        description: item.description,
        occurred_at: item.occurred_at ?? new Date().toISOString(),
        photo_path: input.photo_path ?? null,
        source,
      }));

      const { data: inserted, error } = await ctx.supabase
        .from("transactions")
        .insert(rows)
        .select("id");
      if (error || !inserted) {
        throw new Error(`create_movements insert failed: ${error?.message ?? "no rows"}`);
      }
      const ids = inserted.map((r) => r.id);

      await logAction(ctx.supabase, {
        userId: ctx.userId,
        chatId: ctx.chatId,
        actionType: "create",
        targetIds: ids,
        beforePayload: null,
        afterPayload: rows,
        agentSummary: `creó ${ids.length} movimiento${ids.length === 1 ? "" : "s"}`,
      });

      return {
        created_count: ids.length,
        ids,
        dedup_warnings: dedup
          .filter((d) => d.is_duplicate)
          .map((d) => ({ index: d.batch_index, duplicate_of_tx_id: d.duplicate_of_tx_id })),
      };
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/ai/agent/tools/movements.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/agent/tools/movements.ts tests/ai/agent/tools/movements.test.ts
git commit -m "feat(ai): create_movements tool"
```

---

## Task 7: `update_movement` tool

**Files:**
- Modify: `lib/ai/agent/tools/movements.ts`
- Modify: `tests/ai/agent/tools/movements.test.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/ai/agent/tools/movements.test.ts`:

```ts
import { updateMovementTool } from "@/lib/ai/agent/tools/movements";

describe("update_movement", () => {
  it("reads before-state, updates, and logs action", async () => {
    const before = {
      id: "tx-1",
      user_id: "u",
      wallet_id: "w",
      amount: 200,
      currency: "ARS",
      payee: "Café",
      description: null,
      occurred_at: "2026-05-14T15:00:00Z",
      category_id: "cat-comida",
      type: "expense",
    };
    const after = { ...before, amount: 250 };

    let stage = 0;
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "transactions") {
          stage += 1;
          if (stage === 1) {
            // SELECT before
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    single: vi
                      .fn()
                      .mockResolvedValue({ data: before, error: null }),
                  }),
                }),
              }),
            };
          }
          // UPDATE
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    single: vi
                      .fn()
                      .mockResolvedValue({ data: after, error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "telegram_agent_actions") {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi
                  .fn()
                  .mockResolvedValue({ data: { id: "act-2" }, error: null }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    };

    const tool = updateMovementTool({
      supabase: supabase as never,
      userId: "u",
      chatId: 123,
      mainCurrency: "ARS",
    });
    const out = await tool.execute({ id: "tx-1", patch: { amount: 250 } });
    expect(out.id).toBe("tx-1");
    expect(out.amount).toBe(250);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/ai/agent/tools/movements.test.ts`
Expected: FAIL with "updateMovementTool not exported".

- [ ] **Step 3: Append to `lib/ai/agent/tools/movements.ts`**

```ts
// Append to lib/ai/agent/tools/movements.ts after createMovementsTool.

const UpdateInput = z.object({
  id: z.string().uuid(),
  patch: z
    .object({
      amount: z.number().positive().multipleOf(0.01).optional(),
      currency: z.string().regex(/^[A-Z]{3}$/u).optional(),
      payee: z.string().max(80).nullable().optional(),
      description: z.string().max(200).nullable().optional(),
      category_id: z.string().uuid().nullable().optional(),
      occurred_at: z.string().datetime({ offset: true }).optional(),
      wallet_id: z.string().uuid().optional(),
      type: z.enum(["expense", "income", "transfer"]).optional(),
    })
    .refine((p) => Object.keys(p).length > 0, { message: "patch vacío" }),
});

export function updateMovementTool(ctx: MovementsCtx) {
  return tool({
    description:
      "Modifica un movimiento existente. Antes de llamar, asegurate de tener el id correcto (usá `search_transactions` o `list_recent` para encontrarlo).",
    inputSchema: UpdateInput,
    execute: async (input) => {
      const { data: before, error: readErr } = await ctx.supabase
        .from("transactions")
        .select("*")
        .eq("id", input.id)
        .eq("user_id", ctx.userId)
        .single();
      if (readErr || !before) {
        throw new Error(`update_movement: transacción ${input.id} no encontrada`);
      }

      const { data: after, error: upErr } = await ctx.supabase
        .from("transactions")
        .update(input.patch)
        .eq("id", input.id)
        .eq("user_id", ctx.userId)
        .select("*")
        .single();
      if (upErr || !after) {
        throw new Error(`update_movement failed: ${upErr?.message ?? "no row returned"}`);
      }

      await logAction(ctx.supabase, {
        userId: ctx.userId,
        chatId: ctx.chatId,
        actionType: "update",
        targetIds: [input.id],
        beforePayload: before,
        afterPayload: after,
        agentSummary: `actualizó ${input.id}`,
      });

      return after;
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/ai/agent/tools/movements.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/agent/tools/movements.ts tests/ai/agent/tools/movements.test.ts
git commit -m "feat(ai): update_movement tool"
```

---

## Task 8: `delete_movement` tool

**Files:**
- Modify: `lib/ai/agent/tools/movements.ts`
- Modify: `tests/ai/agent/tools/movements.test.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/ai/agent/tools/movements.test.ts`:

```ts
import { deleteMovementTool } from "@/lib/ai/agent/tools/movements";

describe("delete_movement", () => {
  it("reads row, deletes, logs full row in before_payload", async () => {
    const before = {
      id: "tx-1",
      user_id: "u",
      wallet_id: "w",
      amount: 200,
      currency: "ARS",
      type: "expense",
      occurred_at: "2026-05-14T15:00:00Z",
    };

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "transactions") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi
                    .fn()
                    .mockResolvedValue({ data: before, error: null }),
                }),
              }),
            }),
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          };
        }
        if (table === "telegram_agent_actions") {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi
                  .fn()
                  .mockResolvedValue({ data: { id: "act-3" }, error: null }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    };

    const tool = deleteMovementTool({
      supabase: supabase as never,
      userId: "u",
      chatId: 123,
      mainCurrency: "ARS",
    });
    const out = await tool.execute({ id: "tx-1" });
    expect(out.deleted).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/ai/agent/tools/movements.test.ts`
Expected: FAIL.

- [ ] **Step 3: Append to `lib/ai/agent/tools/movements.ts`**

```ts
const DeleteInput = z.object({
  id: z.string().uuid(),
});

export function deleteMovementTool(ctx: MovementsCtx) {
  return tool({
    description:
      "Elimina un movimiento por id. Antes de llamar, asegurate de tener el id correcto. El usuario puede deshacerlo con /deshacer.",
    inputSchema: DeleteInput,
    execute: async (input) => {
      const { data: before, error: readErr } = await ctx.supabase
        .from("transactions")
        .select("*")
        .eq("id", input.id)
        .eq("user_id", ctx.userId)
        .single();
      if (readErr || !before) {
        throw new Error(`delete_movement: transacción ${input.id} no encontrada`);
      }

      const { error: delErr } = await ctx.supabase
        .from("transactions")
        .delete()
        .eq("id", input.id)
        .eq("user_id", ctx.userId);
      if (delErr) {
        throw new Error(`delete_movement failed: ${delErr.message}`);
      }

      await logAction(ctx.supabase, {
        userId: ctx.userId,
        chatId: ctx.chatId,
        actionType: "delete",
        targetIds: [input.id],
        beforePayload: before,
        afterPayload: null,
        agentSummary: `borró ${input.id}`,
      });

      return { deleted: true as const, id: input.id };
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/ai/agent/tools/movements.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/agent/tools/movements.ts tests/ai/agent/tools/movements.test.ts
git commit -m "feat(ai): delete_movement tool"
```

---

## Task 9: Read tools — wallets, categories, recent

**Files:**
- Create: `lib/ai/agent/tools/reads.ts`
- Create: `tests/ai/agent/tools/reads.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/ai/agent/tools/reads.test.ts
import { describe, expect, it, vi } from "vitest";

import {
  listCategoriesTool,
  listRecentTool,
  listWalletsTool,
} from "@/lib/ai/agent/tools/reads";

/**
 * Builder mock: every chainable method returns the builder itself.
 * `then` makes the builder awaitable at any point in the chain, mirroring
 * how PostgrestQueryBuilder resolves to `{ data, error }` when awaited.
 */
function builderOf(data: unknown, error: unknown = null) {
  const b: Record<string, unknown> = {};
  const chain = () => b;
  for (const k of [
    "select",
    "eq",
    "neq",
    "in",
    "or",
    "is",
    "gte",
    "lte",
    "gt",
    "lt",
    "order",
    "limit",
    "insert",
    "update",
    "delete",
  ]) {
    b[k] = chain;
  }
  b.single = () => Promise.resolve({ data, error });
  b.maybeSingle = () => Promise.resolve({ data, error });
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(resolve);
  return b;
}

describe("list_wallets", () => {
  it("returns user's active wallets by default", async () => {
    const wallets = [
      { id: "w1", name: "Nación", currency: "ARS", archived: false },
      { id: "w2", name: "MP", currency: "ARS", archived: false },
    ];
    const supabase = { from: vi.fn(() => builderOf(wallets)) };
    const tool = listWalletsTool({ supabase: supabase as never, userId: "u" });
    const out = await tool.execute({});
    expect(out.length).toBe(2);
  });
});
```

(Tests for `listCategoriesTool` and `listRecentTool` follow the same pattern; add them inline next.)

- [ ] **Step 2: Append remaining tests to `tests/ai/agent/tools/reads.test.ts`**

```ts
describe("list_categories", () => {
  it("filters by type when provided", async () => {
    const cats = [
      { id: "c1", name: "Comida", type: "expense", parent_id: null },
    ];
    const supabase = { from: vi.fn(() => builderOf(cats)) };
    const tool = listCategoriesTool({ supabase: supabase as never, userId: "u" });
    const out = await tool.execute({ type: "expense" });
    expect(out[0].name).toBe("Comida");
  });
});

describe("list_recent", () => {
  it("returns rows ordered newest first", async () => {
    const rows = [
      { id: "t1", amount: 200, currency: "ARS", type: "expense", occurred_at: "2026-05-14T15:00:00Z", payee: "Café", wallet_id: "w" },
    ];
    const supabase = { from: vi.fn(() => builderOf(rows)) };
    const tool = listRecentTool({ supabase: supabase as never, userId: "u" });
    const out = await tool.execute({});
    expect(out.length).toBe(1);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test tests/ai/agent/tools/reads.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `lib/ai/agent/tools/reads.ts` (wallets, categories, recent)**

```ts
// lib/ai/agent/tools/reads.ts
import { tool } from "ai";
import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

type AdminClient = SupabaseClient<Database>;

export interface ReadCtx {
  supabase: AdminClient;
  userId: string;
}

// -- list_wallets ----------------------------------------------------------

const ListWalletsInput = z.object({
  include_archived: z.boolean().optional(),
});

export function listWalletsTool(ctx: ReadCtx) {
  return tool({
    description: "Devuelve las wallets del usuario (id, name, currency).",
    inputSchema: ListWalletsInput,
    execute: async (input) => {
      let q = ctx.supabase
        .from("wallets")
        .select("id, name, currency, archived")
        .eq("user_id", ctx.userId)
        .order("position", { ascending: true });
      if (!input.include_archived) q = q.eq("archived", false);
      const { data, error } = await q;
      if (error) throw new Error(`list_wallets failed: ${error.message}`);
      return data ?? [];
    },
  });
}

// -- list_categories -------------------------------------------------------

const ListCategoriesInput = z.object({
  type: z.enum(["expense", "income"]).optional(),
});

export function listCategoriesTool(ctx: ReadCtx) {
  return tool({
    description:
      "Devuelve las categorías del usuario (id, name, type, parent_id). Filtrable por tipo.",
    inputSchema: ListCategoriesInput,
    execute: async (input) => {
      let q = ctx.supabase
        .from("categories")
        .select("id, name, type, parent_id")
        .eq("user_id", ctx.userId);
      if (input.type) q = q.eq("type", input.type);
      const { data, error } = await q;
      if (error) throw new Error(`list_categories failed: ${error.message}`);
      return data ?? [];
    },
  });
}

// -- list_recent -----------------------------------------------------------

const ListRecentInput = z.object({
  limit: z.number().int().min(1).max(20).optional(),
  type: z.enum(["expense", "income", "transfer"]).optional(),
  wallet_id: z.string().uuid().optional(),
});

export function listRecentTool(ctx: ReadCtx) {
  return tool({
    description:
      "Lista las últimas N transacciones del usuario. Default 5, máximo 20.",
    inputSchema: ListRecentInput,
    execute: async (input) => {
      const limit = input.limit ?? 5;
      let q = ctx.supabase
        .from("transactions")
        .select(
          "id, amount, currency, type, occurred_at, payee, description, wallet_id, category_id",
        )
        .eq("user_id", ctx.userId)
        .order("occurred_at", { ascending: false })
        .limit(limit);
      if (input.type) q = q.eq("type", input.type);
      if (input.wallet_id) q = q.eq("wallet_id", input.wallet_id);
      const { data, error } = await q;
      if (error) throw new Error(`list_recent failed: ${error.message}`);
      return data ?? [];
    },
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test tests/ai/agent/tools/reads.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/agent/tools/reads.ts tests/ai/agent/tools/reads.test.ts
git commit -m "feat(ai): list_wallets, list_categories, list_recent tools"
```

---

## Task 10: Read tools — balance, search, spend-by-category

**Files:**
- Modify: `lib/ai/agent/tools/reads.ts`
- Modify: `tests/ai/agent/tools/reads.test.ts`

This task adds the three remaining read tools.

- [ ] **Step 1: Append failing tests**

```ts
// Append to tests/ai/agent/tools/reads.test.ts
import {
  getBalanceTool,
  getSpendByCategoryTool,
  searchTransactionsTool,
} from "@/lib/ai/agent/tools/reads";

describe("search_transactions", () => {
  it("matches description ILIKE", async () => {
    const rows = [
      { id: "t1", amount: 200, currency: "ARS", type: "expense", occurred_at: "2026-05-14T15:00:00Z", payee: "Café", description: null, wallet_id: "w", category_id: null },
    ];
    const supabase = { from: vi.fn(() => builderOf(rows)) };
    const tool = searchTransactionsTool({ supabase: supabase as never, userId: "u" });
    const out = await tool.execute({ query: "café" });
    expect(out.length).toBe(1);
  });
});

describe("get_balance", () => {
  it("computes total per wallet", async () => {
    const wallets = [
      { id: "w1", name: "Nación", currency: "ARS", initial_balance: 0 },
      { id: "w2", name: "MP", currency: "ARS", initial_balance: 0 },
    ];
    const txs = [
      { wallet_id: "w1", type: "expense", amount: 200, counterpart_wallet_id: null, counterpart_amount: null },
      { wallet_id: "w2", type: "income", amount: 500, counterpart_wallet_id: null, counterpart_amount: null },
    ];
    let n = 0;
    const supabase = {
      from: vi.fn(() => {
        n += 1;
        return builderOf(n === 1 ? wallets : txs);
      }),
    };
    const tool = getBalanceTool({ supabase: supabase as never, userId: "u" });
    const out = await tool.execute({});
    const w1 = out.wallets.find((w) => w.id === "w1");
    const w2 = out.wallets.find((w) => w.id === "w2");
    expect(w1?.balance).toBe(-200);
    expect(w2?.balance).toBe(500);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/ai/agent/tools/reads.test.ts`
Expected: FAIL.

- [ ] **Step 3: Append to `lib/ai/agent/tools/reads.ts`**

```ts
// -- get_balance -----------------------------------------------------------

const GetBalanceInput = z.object({
  wallet_id: z.string().uuid().optional(),
});

export function getBalanceTool(ctx: ReadCtx) {
  return tool({
    description:
      "Devuelve el balance por wallet del usuario. Si pasás wallet_id, solo esa wallet.",
    inputSchema: GetBalanceInput,
    execute: async (input) => {
      const { data: wallets, error: wErr } = await ctx.supabase
        .from("wallets")
        .select("id, name, currency, initial_balance")
        .eq("user_id", ctx.userId)
        .eq("archived", false)
        .eq("excluded_from_stats", false);
      if (wErr) throw new Error(`get_balance: ${wErr.message}`);
      const walletList = wallets ?? [];
      const ids = walletList.map((w) => w.id);
      if (ids.length === 0) return { wallets: [] };

      let txQuery = ctx.supabase
        .from("transactions")
        .select("wallet_id, type, amount, counterpart_wallet_id, counterpart_amount")
        .eq("user_id", ctx.userId)
        .in("wallet_id", ids);
      if (input.wallet_id) txQuery = txQuery.eq("wallet_id", input.wallet_id);
      const { data: txs, error: tErr } = await txQuery;
      if (tErr) throw new Error(`get_balance: ${tErr.message}`);

      const balance = new Map<string, number>();
      for (const w of walletList) balance.set(w.id, Number(w.initial_balance));
      for (const t of txs ?? []) {
        const wid = t.wallet_id;
        const cur = balance.get(wid) ?? 0;
        if (t.type === "income") balance.set(wid, cur + Number(t.amount));
        else if (t.type === "expense") balance.set(wid, cur - Number(t.amount));
        else if (t.type === "transfer") {
          balance.set(wid, cur - Number(t.amount));
          if (t.counterpart_wallet_id && balance.has(t.counterpart_wallet_id)) {
            const cv = balance.get(t.counterpart_wallet_id) ?? 0;
            balance.set(
              t.counterpart_wallet_id,
              cv + Number(t.counterpart_amount ?? t.amount),
            );
          }
        }
      }

      const out = walletList
        .filter((w) => !input.wallet_id || w.id === input.wallet_id)
        .map((w) => ({
          id: w.id,
          name: w.name,
          currency: w.currency,
          balance: balance.get(w.id) ?? Number(w.initial_balance),
        }));
      return { wallets: out };
    },
  });
}

// -- search_transactions ---------------------------------------------------

const SearchInput = z.object({
  query: z.string().optional(),
  date_from: z.string().datetime({ offset: true }).optional(),
  date_to: z.string().datetime({ offset: true }).optional(),
  type: z.enum(["expense", "income", "transfer"]).optional(),
  wallet_id: z.string().uuid().optional(),
  category_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export function searchTransactionsTool(ctx: ReadCtx) {
  return tool({
    description:
      "Busca transacciones del usuario por texto (description/payee), rango de fechas, tipo, wallet o categoría. Máximo 50 rows.",
    inputSchema: SearchInput,
    execute: async (input) => {
      let q = ctx.supabase
        .from("transactions")
        .select(
          "id, amount, currency, type, occurred_at, payee, description, wallet_id, category_id",
        )
        .eq("user_id", ctx.userId)
        .order("occurred_at", { ascending: false })
        .limit(input.limit ?? 20);
      if (input.query) {
        const safe = input.query.replace(/[%_]/g, "\\$&");
        q = q.or(`payee.ilike.%${safe}%,description.ilike.%${safe}%`);
      }
      if (input.date_from) q = q.gte("occurred_at", input.date_from);
      if (input.date_to) q = q.lte("occurred_at", input.date_to);
      if (input.type) q = q.eq("type", input.type);
      if (input.wallet_id) q = q.eq("wallet_id", input.wallet_id);
      if (input.category_id) q = q.eq("category_id", input.category_id);
      const { data, error } = await q;
      if (error) throw new Error(`search_transactions: ${error.message}`);
      return data ?? [];
    },
  });
}

// -- get_spend_by_category -------------------------------------------------

const GetSpendInput = z.object({
  date_from: z.string().datetime({ offset: true }),
  date_to: z.string().datetime({ offset: true }),
  type: z.enum(["expense", "income"]).optional(),
});

export function getSpendByCategoryTool(ctx: ReadCtx) {
  return tool({
    description:
      "Devuelve total y count por categoría en un rango de fechas. Default type = expense.",
    inputSchema: GetSpendInput,
    execute: async (input) => {
      const type = input.type ?? "expense";
      const { data, error } = await ctx.supabase
        .from("transactions")
        .select("category_id, amount")
        .eq("user_id", ctx.userId)
        .eq("type", type)
        .gte("occurred_at", input.date_from)
        .lte("occurred_at", input.date_to);
      if (error) throw new Error(`get_spend_by_category: ${error.message}`);

      const agg = new Map<string | null, { total: number; count: number }>();
      for (const r of data ?? []) {
        const k = r.category_id;
        const cur = agg.get(k) ?? { total: 0, count: 0 };
        cur.total += Number(r.amount);
        cur.count += 1;
        agg.set(k, cur);
      }

      const catIds = [...agg.keys()].filter((k): k is string => !!k);
      let names = new Map<string, string>();
      if (catIds.length > 0) {
        const { data: cats } = await ctx.supabase
          .from("categories")
          .select("id, name")
          .in("id", catIds);
        for (const c of cats ?? []) names.set(c.id, c.name);
      }
      return [...agg.entries()].map(([id, v]) => ({
        category_id: id,
        category_name: id ? (names.get(id) ?? "?") : "Sin categoría",
        total: v.total,
        count: v.count,
      }));
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/ai/agent/tools/reads.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/agent/tools/reads.ts tests/ai/agent/tools/reads.test.ts
git commit -m "feat(ai): get_balance, search_transactions, get_spend_by_category tools"
```

---

## Task 11: SQL escape hatch tool

**Files:**
- Create: `lib/ai/agent/tools/escape.ts`
- Create: `tests/ai/agent/tools/escape.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/ai/agent/tools/escape.test.ts
import { describe, expect, it, vi } from "vitest";

import {
  runReadonlySqlTool,
  validateSelectOnly,
  withLimit,
} from "@/lib/ai/agent/tools/escape";

describe("validateSelectOnly", () => {
  it("accepts a SELECT that references $1", () => {
    expect(() => validateSelectOnly("SELECT * FROM transactions WHERE user_id = $1")).not.toThrow();
  });
  it("accepts a WITH ... SELECT (CTE)", () => {
    expect(() =>
      validateSelectOnly("WITH x AS (SELECT * FROM transactions WHERE user_id = $1) SELECT * FROM x"),
    ).not.toThrow();
  });
  it("rejects INSERT", () => {
    expect(() => validateSelectOnly("INSERT INTO transactions VALUES (1)")).toThrow();
  });
  it("rejects CTE that wraps an INSERT", () => {
    expect(() =>
      validateSelectOnly(
        "WITH x AS (INSERT INTO transactions VALUES (1) RETURNING *) SELECT * FROM x",
      ),
    ).toThrow();
  });
  it("rejects multiple statements", () => {
    expect(() =>
      validateSelectOnly("SELECT * FROM transactions WHERE user_id = $1; DROP TABLE users"),
    ).toThrow();
  });
  it("rejects SQL without $1 placeholder", () => {
    expect(() => validateSelectOnly("SELECT * FROM transactions")).toThrow();
  });
});

describe("withLimit", () => {
  it("appends LIMIT 100 when missing", () => {
    expect(withLimit("SELECT * FROM x")).toBe("SELECT * FROM x LIMIT 100");
  });
  it("preserves an existing LIMIT", () => {
    expect(withLimit("SELECT * FROM x LIMIT 5")).toBe("SELECT * FROM x LIMIT 5");
  });
});

describe("run_readonly_sql tool", () => {
  it("calls the RPC with the user id parameter and returns rows", async () => {
    const supabase = {
      rpc: vi
        .fn()
        .mockResolvedValue({ data: [{ total: 1500 }], error: null }),
    };
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const tool = runReadonlySqlTool({
      supabase: supabase as never,
      userId: "u-1",
      chatId: 123,
    });
    const out = await tool.execute({
      sql: "SELECT sum(amount) AS total FROM transactions WHERE user_id = $1",
      why: "user pidió total gastado",
    });
    expect(supabase.rpc).toHaveBeenCalledWith("agent_readonly_query", {
      p_sql: "SELECT sum(amount) AS total FROM transactions WHERE user_id = $1 LIMIT 100",
      p_user_id: "u-1",
    });
    expect(out).toEqual([{ total: 1500 }]);
    infoSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/ai/agent/tools/escape.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `lib/ai/agent/tools/escape.ts`**

```ts
// lib/ai/agent/tools/escape.ts
import { tool } from "ai";
import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

type AdminClient = SupabaseClient<Database>;

export interface EscapeCtx {
  supabase: AdminClient;
  userId: string;
  chatId: number;
}

const FORBIDDEN =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|EXECUTE|CALL|MERGE|REPLACE|VACUUM|REINDEX)\b/i;
const MULTI_STMT = /;\s*\S/;

export function validateSelectOnly(sql: string): void {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  if (trimmed.length === 0) {
    throw new Error("run_readonly_sql: sql vacío");
  }
  if (!/^(WITH\s|SELECT\s)/i.test(trimmed)) {
    throw new Error("run_readonly_sql: solo SELECT o WITH ... SELECT");
  }
  if (FORBIDDEN.test(trimmed)) {
    throw new Error("run_readonly_sql: keyword DDL/DML detectado");
  }
  if (MULTI_STMT.test(trimmed)) {
    throw new Error("run_readonly_sql: múltiples statements no permitidos");
  }
  if (!/\$1\b/.test(trimmed)) {
    throw new Error("run_readonly_sql: el SQL debe referenciar $1 para user_id");
  }
}

export function withLimit(sql: string, max = 100): string {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  return /\bLIMIT\s+\d+/i.test(trimmed) ? trimmed : `${trimmed} LIMIT ${max}`;
}

const Input = z.object({
  sql: z
    .string()
    .min(1)
    .describe(
      "SELECT (o WITH...SELECT). Debe referenciar $1 como placeholder para user_id. LIMIT 100 se agrega automáticamente si no está.",
    ),
  why: z
    .string()
    .min(5)
    .describe("Por qué ninguna otra tool encaja. Se loguea para auditoría."),
});

function hashSql(sql: string): string {
  // Tiny non-crypto hash (FNV-1a) — only used as a log identifier.
  let h = 2166136261;
  for (let i = 0; i < sql.length; i += 1) {
    h ^= sql.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h.toString(16);
}

export function runReadonlySqlTool(ctx: EscapeCtx) {
  return tool({
    description:
      "Último recurso. Ejecuta una query SELECT contra los datos del usuario para responder analytics que ninguna otra tool cubre. El SQL DEBE usar $1 como placeholder del user_id (se vincula server-side). Solo se permite SELECT/WITH; nada de escritura.",
    inputSchema: Input,
    execute: async (input) => {
      validateSelectOnly(input.sql);
      const limited = withLimit(input.sql);
      console.info("[agent/escape]", {
        user_id: ctx.userId,
        chat_id: ctx.chatId,
        sql_hash: hashSql(limited),
        why: input.why,
      });
      const { data, error } = await ctx.supabase.rpc("agent_readonly_query", {
        p_sql: limited,
        p_user_id: ctx.userId,
      });
      if (error) throw new Error(`run_readonly_sql: ${error.message}`);
      return data;
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/ai/agent/tools/escape.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/agent/tools/escape.ts tests/ai/agent/tools/escape.test.ts
git commit -m "feat(ai): run_readonly_sql escape hatch"
```

---

## Task 12: Aggregate tools (`buildTools`)

**Files:**
- Create: `lib/ai/agent/tools/index.ts`

- [ ] **Step 1: Write `buildTools`**

```ts
// lib/ai/agent/tools/index.ts
import {
  createMovementsTool,
  deleteMovementTool,
  updateMovementTool,
  type MovementsCtx,
} from "./movements";
import {
  getBalanceTool,
  getSpendByCategoryTool,
  listCategoriesTool,
  listRecentTool,
  listWalletsTool,
  searchTransactionsTool,
  type ReadCtx,
} from "./reads";
import { runReadonlySqlTool, type EscapeCtx } from "./escape";

export type AgentToolsCtx = MovementsCtx & ReadCtx & EscapeCtx;

export function buildTools(ctx: AgentToolsCtx) {
  return {
    create_movements: createMovementsTool(ctx),
    update_movement: updateMovementTool(ctx),
    delete_movement: deleteMovementTool(ctx),
    get_balance: getBalanceTool(ctx),
    list_recent: listRecentTool(ctx),
    list_wallets: listWalletsTool(ctx),
    list_categories: listCategoriesTool(ctx),
    search_transactions: searchTransactionsTool(ctx),
    get_spend_by_category: getSpendByCategoryTool(ctx),
    run_readonly_sql: runReadonlySqlTool(ctx),
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/agent/tools/index.ts
git commit -m "feat(ai): aggregate tool builder"
```

---

## Task 13: `runExpenseAgent` entrypoint

**Files:**
- Create: `lib/ai/agent/index.ts`
- Create: `tests/ai/agent/index.test.ts`

- [ ] **Step 1: Write a failing smoke test**

```ts
// tests/ai/agent/index.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("ai", async () => {
  const real = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...real,
    generateText: vi.fn(async () => ({
      text: "Listo, registré tu café.",
      steps: [],
      toolCalls: [],
    })),
    stepCountIs: real.stepCountIs ?? (() => () => true),
  };
});

import { runExpenseAgent } from "@/lib/ai/agent";

describe("runExpenseAgent", () => {
  it("invokes the model and returns the final text", async () => {
    const supabase = { from: vi.fn() } as never;
    const out = await runExpenseAgent({
      supabase,
      userId: "u",
      chatId: 1,
      mainCurrency: "ARS",
      text: "gasté 200 en café",
    });
    expect(out.text).toBe("Listo, registré tu café.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/ai/agent/index.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `lib/ai/agent/index.ts`**

```ts
// lib/ai/agent/index.ts
import { generateText, stepCountIs } from "ai";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

import { gemma4, requireGoogleAi } from "./provider";
import { buildSystemPrompt, currentDateContext } from "./prompts";
import { buildTools } from "./tools";

type AdminClient = SupabaseClient<Database>;

export interface RunAgentInput {
  supabase: AdminClient;
  userId: string;
  chatId: number;
  mainCurrency: string;
  text?: string;
  image?: { data: Uint8Array; mimeType: string };
}

const FALLBACK_REPLY = "No pude procesar tu mensaje. Probá de nuevo o mandalo distinto.";

export class AgentQuotaError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AgentQuotaError";
  }
}

export async function runExpenseAgent(input: RunAgentInput): Promise<{ text: string }> {
  requireGoogleAi();

  const dateCtx = currentDateContext();
  const system = buildSystemPrompt({ ...dateCtx, mainCurrency: input.mainCurrency });
  const tools = buildTools({
    supabase: input.supabase,
    userId: input.userId,
    chatId: input.chatId,
    mainCurrency: input.mainCurrency,
  });

  const userParts: (
    | { type: "text"; text: string }
    | { type: "image"; image: Uint8Array; mediaType: string }
  )[] = [];
  if (input.image) {
    userParts.push({
      type: "image",
      image: input.image.data,
      mediaType: input.image.mimeType,
    });
  }
  if (input.text && input.text.length > 0) {
    userParts.push({ type: "text", text: input.text });
  }
  if (userParts.length === 0) {
    return { text: FALLBACK_REPLY };
  }

  const startedAt = Date.now();
  try {
    const result = await generateText({
      model: gemma4,
      system,
      messages: [{ role: "user", content: userParts }],
      tools,
      stopWhen: stepCountIs(5),
      toolChoice: "auto",
      temperature: 0,
      onStepFinish: ({ toolCalls, stepType }) => {
        for (const tc of toolCalls ?? []) {
          console.info("[agent/step]", {
            user_id: input.userId,
            chat_id: input.chatId,
            step_type: stepType,
            tool_name: tc.toolName,
            ms_elapsed: Date.now() - startedAt,
          });
        }
      },
    });
    const text = result.text?.trim();
    if (!text || text.length === 0) {
      return { text: FALLBACK_REPLY };
    }
    return { text };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/quota|rate.?limit|429/i.test(msg)) {
      throw new AgentQuotaError("Quota Gemma agotada", { cause: err });
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/ai/agent/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/agent/index.ts tests/ai/agent/index.test.ts
git commit -m "feat(ai): runExpenseAgent entrypoint"
```

---

## Task 14: Wire `handlers/text.ts` to the agent

**Files:**
- Modify: `lib/telegram/handlers/text.ts`

- [ ] **Step 1: Replace the AI extraction call**

Replace the entire body of `lib/telegram/handlers/text.ts` with:

```ts
// Free-text handler wired to the agent.
//
// The agent owns all AI decisions (create movements, query data, etc.).
// Maintenance and ambiguous-input replies live here.

import type { Bot, Context, NextFunction } from "grammy";

import { AgentQuotaError, runExpenseAgent } from "@/lib/ai/agent";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLinkedUser } from "@/lib/telegram/get-linked-user";

const ONBOARDING_TEXT = "Hola, primero vinculá la cuenta. /start.";
const MAINTENANCE_TEXT = "Servicio en mantenimiento";
const GENERIC_ERROR = "Algo falló procesando tu mensaje. Probá de nuevo.";
const QUOTA_ERROR =
  "Mi cuota AI llegó al límite de hoy. Probá mañana o usá /saldo y /ultimos.";

export function registerTextHandler(bot: Bot): void {
  bot.on("message:text", handleText);
}

async function handleText(ctx: Context, next: NextFunction): Promise<void> {
  const from = ctx.from;
  const chat = ctx.chat;
  const message = ctx.message;
  if (!from || !chat || !message || !message.text) {
    return next();
  }

  const commandEntities = ctx.entities("bot_command");

  const supabaseConfigured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseConfigured || !process.env.TELEGRAM_BOT_TOKEN) {
    if (commandEntities.length === 0) {
      await ctx.reply(MAINTENANCE_TEXT);
    }
    return next();
  }

  if (commandEntities.length > 0) {
    return next();
  }

  const linked = await getLinkedUser(from.id);
  if (!linked) {
    await ctx.reply(ONBOARDING_TEXT);
    return;
  }

  try {
    const supabase = createAdminClient();
    const out = await runExpenseAgent({
      supabase,
      userId: linked.user_id,
      chatId: chat.id,
      mainCurrency: linked.main_currency,
      text: message.text,
    });
    await ctx.reply(out.text);
  } catch (err) {
    if (err instanceof AgentQuotaError) {
      await ctx.reply(QUOTA_ERROR);
      return;
    }
    console.error("[telegram/text] agent error", err);
    await ctx.reply(GENERIC_ERROR);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Manual smoke test against dev bot**

Set env vars in `.env.local`, run `pnpm dev`, and send a message to the dev bot:
- "gasté 200 en café" → expect a reply confirming the new transaction.
- "cuánto gasté en comida este mes" → expect an aggregated reply.
- "no entiendo" → expect a polite text response, no row inserted.

- [ ] **Step 4: Commit**

```bash
git add lib/telegram/handlers/text.ts
git commit -m "feat(telegram): wire text handler to expense agent"
```

---

## Task 15: Wire `handlers/photo.ts` to the agent

**Files:**
- Modify: `lib/telegram/handlers/photo.ts`

- [ ] **Step 1: Replace the body**

Replace the entire body of `lib/telegram/handlers/photo.ts` with:

```ts
// Photo handler wired to the agent.
//
// Downloads the photo, uploads it to storage so the agent can persist
// photo_path on each created row, then calls runExpenseAgent with the image
// bytes.

import type { Bot, Context } from "grammy";

import { AgentQuotaError, runExpenseAgent } from "@/lib/ai/agent";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLinkedUser } from "@/lib/telegram/get-linked-user";
import {
  fetchTelegramFile,
  uploadReceiptToStorage,
} from "@/lib/telegram/storage-helpers";

const ONBOARDING_TEXT = "Hola, primero vinculá la cuenta. /start.";
const MAINTENANCE_TEXT = "Servicio en mantenimiento";
const GENERIC_ERROR = "Algo falló procesando la foto. Probá de nuevo.";
const QUOTA_ERROR =
  "Mi cuota AI llegó al límite de hoy. Probá mañana o usá /saldo y /ultimos.";

export function registerPhotoHandler(bot: Bot): void {
  bot.on("message:photo", handlePhoto);
}

async function handlePhoto(ctx: Context): Promise<void> {
  const from = ctx.from;
  const chat = ctx.chat;
  const message = ctx.message;
  if (
    !from ||
    !chat ||
    !message ||
    !message.photo ||
    message.photo.length === 0
  ) {
    return;
  }

  const supabaseConfigured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseConfigured || !process.env.TELEGRAM_BOT_TOKEN) {
    await ctx.reply(MAINTENANCE_TEXT);
    return;
  }

  const linked = await getLinkedUser(from.id);
  if (!linked) {
    await ctx.reply(ONBOARDING_TEXT);
    return;
  }

  const largest = message.photo[message.photo.length - 1];
  if (!largest?.file_id) {
    await ctx.reply(GENERIC_ERROR);
    return;
  }

  let bytes: Uint8Array;
  try {
    const file = await ctx.api.getFile(largest.file_id);
    if (!file.file_path) throw new Error("Telegram returned no file_path");
    bytes = await fetchTelegramFile(file.file_path);
  } catch (err) {
    console.error("[telegram/photo] download failed", err);
    await ctx.reply(GENERIC_ERROR);
    return;
  }

  let photoPath: string;
  try {
    photoPath = await uploadReceiptToStorage(linked.user_id, bytes, "jpg");
  } catch (err) {
    console.error("[telegram/photo] storage upload failed", err);
    await ctx.reply(GENERIC_ERROR);
    return;
  }

  try {
    const supabase = createAdminClient();
    // We pass photoPath via caption text so the agent can include it in
    // create_movements. The system prompt mentions this convention.
    const captionPart = message.caption ? `${message.caption}\n\n` : "";
    const out = await runExpenseAgent({
      supabase,
      userId: linked.user_id,
      chatId: chat.id,
      mainCurrency: linked.main_currency,
      text: `${captionPart}[photo_path: ${photoPath}]`,
      image: { data: bytes, mimeType: "image/jpeg" },
    });
    await ctx.reply(out.text);
  } catch (err) {
    if (err instanceof AgentQuotaError) {
      await ctx.reply(QUOTA_ERROR);
      return;
    }
    console.error("[telegram/photo] agent error", err);
    await ctx.reply(GENERIC_ERROR);
  }
}
```

- [ ] **Step 2: Update the system prompt to teach the agent about `[photo_path: …]`**

In `lib/ai/agent/prompts.ts`, inside `buildSystemPrompt`, insert this rule between the `"REGLAS:"` block and `"WRITES son auto-execute..."`:

```
"- Si el mensaje contiene `[photo_path: <ruta>]`, pasá ese valor en el parámetro `photo_path` de `create_movements` para que la foto quede asociada a los movimientos.",
```

- [ ] **Step 3: Typecheck + manual smoke**

Run: `pnpm typecheck`
Expected: no errors.

Manual: send a photo of a ticket to the dev bot. Expected: a reply confirming the new transaction(s); the `transactions.photo_path` column should hold the uploaded path.

- [ ] **Step 4: Commit**

```bash
git add lib/telegram/handlers/photo.ts lib/ai/agent/prompts.ts
git commit -m "feat(telegram): wire photo handler to expense agent"
```

---

## Task 16: "Voice deshabilitado" notice

**Files:**
- Modify: `lib/telegram/handlers/voice.ts`

- [ ] **Step 1: Replace the body**

```ts
// Voice handler — disabled in the Gemma 4 era.
//
// Gemma 4 hosted variants on Gemini API do not support audio. Self-hosting
// the E4B variant would break the $0/mes constraint. Instead of accepting
// voice messages and silently failing, we reply with a clear notice so the
// user knows to send text or a photo.

import type { Bot, Context } from "grammy";

import { getLinkedUser } from "@/lib/telegram/get-linked-user";

const ONBOARDING_TEXT = "Hola, primero vinculá la cuenta. /start.";
const DISABLED_TEXT =
  "Voice deshabilitado. Mandame el gasto por texto o sacale una foto al ticket.";

export function registerVoiceHandler(bot: Bot): void {
  bot.on(["message:voice", "message:audio"], handleVoice);
}

async function handleVoice(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;
  const linked = await getLinkedUser(from.id);
  if (!linked) {
    await ctx.reply(ONBOARDING_TEXT);
    return;
  }
  await ctx.reply(DISABLED_TEXT);
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/telegram/handlers/voice.ts
git commit -m "feat(telegram): voice handler returns disabled notice"
```

---

## Task 17: `/deshacer` command

**Files:**
- Create: `lib/telegram/handlers/undo.ts`
- Modify: `lib/telegram/handlers/index.ts`
- Create: `tests/telegram/handlers/undo.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/telegram/handlers/undo.test.ts
import { describe, expect, it, vi } from "vitest";

import { reverseLastAction } from "@/lib/telegram/handlers/undo";

describe("reverseLastAction (create)", () => {
  it("deletes the created rows and marks reversed", async () => {
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "telegram_agent_actions") {
          // First call: getLastReversibleAction returns the action row.
          // Second call: markReversed updates it.
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: {
                          id: "act-1",
                          action_type: "create",
                          target_ids: ["tx-1", "tx-2"],
                          before_payload: null,
                          after_payload: [],
                          agent_summary: "creó 2 movimientos",
                        },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  select: vi
                    .fn()
                    .mockResolvedValue({ data: [{ id: "act-1" }], error: null }),
                }),
              }),
            }),
          };
        }
        if (table === "transactions") {
          return {
            delete: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    };
    const result = await reverseLastAction(supabase as never, "u-1");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.summary).toBe("creó 2 movimientos");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/telegram/handlers/undo.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `lib/telegram/handlers/undo.ts`**

```ts
// /deshacer command — reverses the last unreverted agent write.

import type { Bot, CommandContext, Context } from "grammy";

import {
  getLastReversibleAction,
  markReversed,
} from "@/lib/ai/agent/action-log";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getLinkedUser } from "@/lib/telegram/get-linked-user";
import type { Database } from "@/lib/supabase/database.types";

type AdminClient = SupabaseClient<Database>;

const ONBOARDING_TEXT = "Hola, primero vinculá la cuenta. /start.";
const NOTHING_TEXT = "No hay nada para deshacer.";
const RACE_TEXT = "Ya estaba deshecho.";
const FAIL_TEXT =
  "No pude deshacer: la transacción ya no existe o cambió desde entonces.";

export type UndoResult =
  | { kind: "nothing" }
  | { kind: "race" }
  | { kind: "fail" }
  | { kind: "ok"; summary: string };

export async function reverseLastAction(
  supabase: AdminClient,
  userId: string,
): Promise<UndoResult> {
  const action = await getLastReversibleAction(supabase, userId);
  if (!action) return { kind: "nothing" };

  try {
    if (action.action_type === "create") {
      const { error } = await supabase
        .from("transactions")
        .delete()
        .in("id", action.target_ids)
        .eq("user_id", userId);
      if (error) {
        console.error("[undo] create reverse failed", error);
        return { kind: "fail" };
      }
    } else if (action.action_type === "update") {
      const before = action.before_payload as Record<string, unknown> | null;
      if (!before || typeof before !== "object") return { kind: "fail" };
      const targetId = action.target_ids[0];
      const { error } = await supabase
        .from("transactions")
        .update(before as never)
        .eq("id", targetId)
        .eq("user_id", userId);
      if (error) {
        console.error("[undo] update reverse failed", error);
        return { kind: "fail" };
      }
    } else if (action.action_type === "delete") {
      const before = action.before_payload as Record<string, unknown> | null;
      if (!before || typeof before !== "object") return { kind: "fail" };
      const { error } = await supabase
        .from("transactions")
        .insert(before as never);
      if (error) {
        console.error("[undo] delete reverse failed", error);
        return { kind: "fail" };
      }
    }
  } catch (err) {
    console.error("[undo] unexpected", err);
    return { kind: "fail" };
  }

  const marked = await markReversed(supabase, action.id);
  if (!marked) return { kind: "race" };
  return { kind: "ok", summary: action.agent_summary ?? "última acción" };
}

export function registerUndoHandler(bot: Bot): void {
  bot.command("deshacer", handleUndo);
}

async function handleUndo(ctx: CommandContext<Context>): Promise<void> {
  const from = ctx.from;
  if (!from) return;
  const linked = await getLinkedUser(from.id);
  if (!linked) {
    await ctx.reply(ONBOARDING_TEXT);
    return;
  }
  const supabase = createAdminClient();
  const res = await reverseLastAction(supabase, linked.user_id);
  switch (res.kind) {
    case "nothing":
      await ctx.reply(NOTHING_TEXT);
      return;
    case "race":
      await ctx.reply(RACE_TEXT);
      return;
    case "fail":
      await ctx.reply(FAIL_TEXT);
      return;
    case "ok":
      await ctx.reply(`↩️ Deshecho: ${res.summary} → revertido.`);
      return;
  }
}
```

- [ ] **Step 4: Register in `handlers/index.ts`**

Modify `lib/telegram/handlers/index.ts`:

Add import after the existing imports:
```ts
import { registerUndoHandler } from "./undo";
```

Then inside `registerHandlers`, add `registerUndoHandler(bot);` immediately after `registerStatusHandlers(bot);` so `/deshacer` lives next to `/saldo` and `/ultimos`. The final order should be:

```ts
export function registerHandlers(bot: Bot): void {
  registerStartHandler(bot);
  registerStatusHandlers(bot);
  registerUndoHandler(bot);

  registerBatchHandler(bot);
  registerConfirmHandler(bot);
  registerPhotoHandler(bot);
  registerVoiceHandler(bot);
  registerTextHandler(bot);

  registerCatchAll(bot);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test tests/telegram/handlers/undo.test.ts`
Expected: PASS.

- [ ] **Step 6: Manual smoke**

Run `pnpm dev`. In the dev bot:
1. Send "gasté 200 en café" → bot creates one transaction.
2. Send `/deshacer` → bot replies "↩️ Deshecho: creó 1 movimiento → revertido."
3. Send `/deshacer` again → bot replies "No hay nada para deshacer."

- [ ] **Step 7: Commit**

```bash
git add lib/telegram/handlers/undo.ts lib/telegram/handlers/index.ts tests/telegram/handlers/undo.test.ts
git commit -m "feat(telegram): /deshacer command"
```

---

## Task 18: Cleanup — delete dead AI files

**Files:**
- Delete: `lib/ai/extract-expense.ts`
- Delete: `lib/ai/provider.ts`
- Modify: `lib/ai/schemas.ts` (drop unused exports if no consumer remains)

- [ ] **Step 1: Verify nothing imports `lib/ai/extract-expense`**

Run: `grep -rn "lib/ai/extract-expense" lib app actions 2>/dev/null`
Expected: no results (only test files at most). If anything matches, stop and re-check.

- [ ] **Step 2: Verify nothing imports `lib/ai/provider`**

Run: `grep -rn "from \"@/lib/ai/provider\"" lib app actions 2>/dev/null`
Expected: no results.

- [ ] **Step 3: Delete the files**

```bash
git rm lib/ai/extract-expense.ts lib/ai/provider.ts
```

- [ ] **Step 4: Check `lib/ai/schemas.ts` for unused exports**

Run: `grep -rn "ExpenseBatchExtraction\|ExpenseExtraction\b\|SourceKind\|CATEGORY_HINTS" lib app actions 2>/dev/null`
For each export that has NO non-test consumers, remove it from `lib/ai/schemas.ts`. `ExpenseItemSchema` MUST stay (used inside `create_movements`).

- [ ] **Step 5: Typecheck + tests**

Run: `pnpm typecheck && pnpm test`
Expected: no errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/schemas.ts
git commit -m "chore(ai): remove dead extract-expense + provider, prune schemas"
```

---

## Verification checklist

After Task 18, verify the full migration before opening the PR:

- [ ] `pnpm typecheck` clean.
- [ ] `pnpm test` all green.
- [ ] `pnpm lint` clean.
- [ ] Dev bot smoke: text expense, photo ticket, screenshot wallet feed, "cuánto gasté en comida en abril", `/deshacer`, `/deshacer` (nothing left), `/saldo` (still works), `/ultimos` (still works), voice message (returns "voice deshabilitado").
- [ ] Manually confirm `transactions` rows have the right `source` (`telegram_text` for text, `telegram_photo` for photos).
- [ ] Manually confirm `telegram_agent_actions` has one row per write turn.
- [ ] Hit the SQL escape hatch: send a question that none of the read tools cover well (e.g., "cuál es mi mayor gasto único en abril"); verify the agent uses `run_readonly_sql` and the response is correct.
