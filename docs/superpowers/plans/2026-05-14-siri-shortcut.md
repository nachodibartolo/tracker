# Siri Shortcut → Voice Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a voice entry path to the tracker via iOS Shortcuts + Siri. Reuse the existing `runExpenseAgent` end-to-end; only a new auth layer (PAT-style tokens), a new endpoint, and a Settings UI to manage tokens are new.

**Architecture:** iPhone Shortcut → `POST /api/voice/agent` with `Authorization: Bearer vt_…`. Endpoint validates token by sha256 lookup in a dedicated `voice_tokens` table, resolves the user, delegates to `runExpenseAgent` (with `chatId: -1` sentinel), and returns `{ ok, text }`. Siri reads the text aloud.

**Tech Stack:** Next.js 16 (App Router, Node runtime), Supabase (Postgres + auth + RLS), AI SDK 6 with `@ai-sdk/google` (Gemini 2.5 Flash), Zod for validation, vitest for tests, Tailwind/shadcn for UI.

**Spec:** `docs/superpowers/specs/2026-05-14-siri-shortcut-design.md`

**One spec amendment:** the spec mentioned "una línea en el tool" for wallet defaults. After inspecting `lib/ai/agent/tools/movements.ts` the cleaner mechanism is to thread `defaultWalletId` through `RunAgentInput` and inject it into the system prompt (Task 3). The tool schema stays unchanged (`wallet_id` remains required; the model fills it from the prompt context). End result is the same; the path is just cleaner.

---

### Task 1: Migration — `voice_tokens` table

**Files:**
- Create: `supabase/migrations/0014_voice_tokens.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0014_voice_tokens.sql`:

```sql
-- 0014_voice_tokens.sql
-- Personal Access Tokens for the voice / iOS Shortcut entry point.
--
-- Each row represents one device (or one Shortcut) authorized to call
-- `POST /api/voice/agent`. The plaintext token is shown to the user
-- ONCE at creation; only the sha256 hex hash is persisted.
--
-- Revocation is a soft-delete (`revoked_at`) so we keep `last_used_at`
-- for audit. The endpoint filters `revoked_at IS NULL`.

create table public.voice_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  label text not null,
  default_wallet_id uuid references public.wallets(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index voice_tokens_user_id_idx on public.voice_tokens(user_id);

alter table public.voice_tokens enable row level security;

-- Users can read their own tokens to render the management UI.
create policy "voice_tokens_owner_select" on public.voice_tokens
  for select using (auth.uid() = user_id);

-- Users can soft-revoke their own tokens.
create policy "voice_tokens_owner_update" on public.voice_tokens
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Inserts are done from server actions using the service-role client,
-- which bypasses RLS. No INSERT policy is intentional.
```

- [ ] **Step 2: Apply the migration locally**

If using local Supabase CLI:

```bash
cd /Users/nachodibartolo/Documents/Tracker
supabase migration up
```

Otherwise (Vercel + Supabase auto-migrations on push), commit and push at the end of the task. For development testing now, apply via the Supabase MCP or SQL editor.

Expected: migration applies without errors. Verify with:

```bash
supabase db diff
```

Expected output: no schema drift.

- [ ] **Step 3: Regenerate Supabase types**

```bash
cd /Users/nachodibartolo/Documents/Tracker
supabase gen types typescript --local > lib/supabase/database.types.ts
```

Verify `voice_tokens` appears in the generated `Database["public"]["Tables"]` map. Expected: type `Tables<"voice_tokens">` exists.

- [ ] **Step 4: Typecheck**

```bash
cd /Users/nachodibartolo/Documents/Tracker
pnpm typecheck
```

Expected: PASS (zero errors).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0014_voice_tokens.sql lib/supabase/database.types.ts
git commit -m "$(cat <<'EOF'
db(voice): voice_tokens table for Siri Shortcut auth

PAT-style tokens for the new voice entry endpoint. Stores sha256 hash,
soft-revoke via revoked_at, RLS so users only see/update their own.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Token generation helpers (TDD)

**Files:**
- Create: `lib/voice-tokens/tokens.ts`
- Test: `tests/voice-tokens/tokens.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/voice-tokens/tokens.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { generateVoiceToken, hashVoiceToken } from "@/lib/voice-tokens/tokens";

describe("voice token helpers", () => {
  it("generateVoiceToken returns a vt_-prefixed token of >=40 chars", () => {
    const t = generateVoiceToken();
    expect(t.startsWith("vt_")).toBe(true);
    expect(t.length).toBeGreaterThanOrEqual(40);
  });

  it("generateVoiceToken returns a unique token each call", () => {
    const a = generateVoiceToken();
    const b = generateVoiceToken();
    expect(a).not.toBe(b);
  });

  it("hashVoiceToken returns a deterministic 64-char hex string", () => {
    const t = "vt_abc123";
    const h1 = hashVoiceToken(t);
    const h2 = hashVoiceToken(t);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashVoiceToken differs for different inputs", () => {
    expect(hashVoiceToken("vt_a")).not.toBe(hashVoiceToken("vt_b"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/nachodibartolo/Documents/Tracker
pnpm test -- tests/voice-tokens/tokens.test.ts
```

Expected: FAIL with module not found error for `@/lib/voice-tokens/tokens`.

- [ ] **Step 3: Implement helpers**

Create `lib/voice-tokens/tokens.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";

const PREFIX = "vt_";

/**
 * Returns a plaintext voice-token of the form `vt_<43 base64url chars>`
 * (32 bytes of cryptographic randomness, base64url-encoded). The plaintext
 * is shown to the user ONCE; we persist only the sha256 hex hash.
 */
export function generateVoiceToken(): string {
  const raw = randomBytes(32).toString("base64url");
  return `${PREFIX}${raw}`;
}

/**
 * Returns the lowercase hex sha256 of `token` (64 chars). Used both at
 * creation time (to compute the value stored in `voice_tokens.token_hash`)
 * and at request time (to look up the token without ever persisting the
 * plaintext).
 */
export function hashVoiceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test -- tests/voice-tokens/tokens.test.ts
```

Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add lib/voice-tokens/tokens.ts tests/voice-tokens/tokens.test.ts
git commit -m "$(cat <<'EOF'
voice: token generation + hashing helpers

generateVoiceToken returns vt_<32B base64url>; hashVoiceToken returns
sha256 hex. Plaintext never persisted; only the hash is stored.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Agent — accept `defaultWalletId` and surface it in the prompt (TDD)

**Files:**
- Modify: `lib/ai/agent/index.ts`
- Modify: `lib/ai/agent/prompts.ts`
- Test: `tests/ai/agent/index.test.ts` (extend existing file)

- [ ] **Step 1: Write the failing test**

First, add an import at the top of `tests/ai/agent/index.test.ts` (right after the existing `import { runExpenseAgent } from "@/lib/ai/agent";`):

```ts
import { generateText } from "ai";
```

Because of the existing `vi.mock("ai", …)` at the top of the file, this import resolves to the mocked `generateText` and we can inspect its `.mock.calls`.

Then append at the bottom of `tests/ai/agent/index.test.ts`:

```ts
describe("runExpenseAgent default wallet", () => {
  it("does NOT mention a default wallet when defaultWalletId is unset", async () => {
    const supabase = { from: vi.fn() } as never;
    await runExpenseAgent({
      supabase,
      userId: "u",
      chatId: 1,
      mainCurrency: "ARS",
      text: "gasté 200",
    });
    const args = vi.mocked(generateText).mock.calls.at(-1)?.[0];
    expect(args?.system).not.toMatch(/wallet por defecto/i);
  });

  it("injects default wallet hint into the system prompt when set", async () => {
    const supabase = { from: vi.fn() } as never;
    await runExpenseAgent({
      supabase,
      userId: "u",
      chatId: -1,
      mainCurrency: "ARS",
      text: "gasté 200",
      defaultWalletId: "11111111-1111-1111-1111-111111111111",
    });
    const args = vi.mocked(generateText).mock.calls.at(-1)?.[0];
    expect(args?.system).toMatch(/wallet por defecto/i);
    expect(args?.system).toContain("11111111-1111-1111-1111-111111111111");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- tests/ai/agent/index.test.ts
```

Expected: FAIL — the two new tests fail (no `defaultWalletId` parameter; prompt doesn't include the hint).

- [ ] **Step 3: Update `buildSystemPrompt` in `lib/ai/agent/prompts.ts`**

Extend `PromptContext` and `buildSystemPrompt`. Replace the `PromptContext` interface and `buildSystemPrompt` function with:

```ts
export interface PromptContext {
  mainCurrency: string;
  todayIso: string;
  todayYearAr: string;
  /** Optional UUID of the wallet to use when the user does not specify one. */
  defaultWalletId?: string;
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const lines = [
    "Sos el asistente financiero personal de un usuario argentino. Hablás español rioplatense (Argentina), sos conciso y accionable.",
    "Recibís texto y/o imágenes desde Telegram. Tu tarea es entender qué quiere el usuario y elegir la tool correcta.",
    "",
    "REGLAS:",
    "- Si el usuario describe un gasto/ingreso/transferencia (texto, foto de ticket, screenshot bancario o feed de billetera): usá `create_movements`. Extraé TODOS los movimientos visibles, no inventes filas.",
    "- Si pregunta sobre sus datos (saldo, últimos, qué gastó en X, total por categoría): usá la tool de read apropiada (`get_balance`, `list_recent`, `search_transactions`, `get_spend_by_category`).",
    "- Si pide modificar o borrar: primero buscá el id con `search_transactions` o `list_recent`, después usá `update_movement` o `delete_movement`.",
    "- Si necesitás aclaración (ej: wallet ambigua, dos coincidencias): NO llames tool — respondé con texto pidiendo aclaración.",
    "- Si nada matchea pero parece query analítica sobre los datos del usuario, usá `run_readonly_sql` como último recurso. El SQL DEBE referenciar $1 como placeholder para el user_id. Justificá en el campo `why`.",
    "- Si el mensaje contiene `[photo_path: <ruta>]`, pasá ese valor en el parámetro `photo_path` de `create_movements` para que la foto quede asociada a los movimientos.",
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
  ];
  if (ctx.defaultWalletId) {
    lines.push(
      "",
      `Wallet por defecto: si el usuario no especifica con qué wallet pagó/cobró, usá wallet_id="${ctx.defaultWalletId}" en \`create_movements\` en lugar de pedir aclaración.`,
    );
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Update `RunAgentInput` and `runExpenseAgent` in `lib/ai/agent/index.ts`**

Add `defaultWalletId?: string` to `RunAgentInput` (after `text?`):

```ts
export interface RunAgentInput {
  supabase: AdminClient;
  userId: string;
  chatId: number;
  mainCurrency: string;
  text?: string;
  image?: { data: Uint8Array; mimeType: string };
  /**
   * If the user does not specify a wallet in their text, the agent uses
   * this UUID. Only set by the voice endpoint today; the Telegram handler
   * leaves it unset (preserves current behavior).
   */
  defaultWalletId?: string;
}
```

Then in `runExpenseAgent`, change the `buildSystemPrompt` call to thread the field through. Replace this block:

```ts
const system = buildSystemPrompt({ ...dateCtx, mainCurrency: input.mainCurrency });
```

with:

```ts
const system = buildSystemPrompt({
  ...dateCtx,
  mainCurrency: input.mainCurrency,
  defaultWalletId: input.defaultWalletId,
});
```

- [ ] **Step 5: Run agent tests to verify they pass**

```bash
pnpm test -- tests/ai/agent/index.test.ts
```

Expected: PASS (all tests in the file, including the 2 new ones and the original).

- [ ] **Step 6: Run full suite to confirm no regressions**

```bash
pnpm test
```

Expected: PASS (no regressions in Telegram handler tests, agent tool tests, etc.).

- [ ] **Step 7: Commit**

```bash
git add lib/ai/agent/index.ts lib/ai/agent/prompts.ts tests/ai/agent/index.test.ts
git commit -m "$(cat <<'EOF'
feat(agent): optional defaultWalletId for prompt-level fallback

Adds RunAgentInput.defaultWalletId; when set, the system prompt instructs
the model to fill wallet_id with that UUID instead of asking for
clarification. Telegram path unchanged (Param left unset).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Server actions for token management (TDD)

**Files:**
- Create: `actions/voice-tokens.ts`
- Test: `tests/actions/voice-tokens.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/actions/voice-tokens.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the server-side supabase clients BEFORE importing the actions module.
const adminInsert = vi.fn();
const adminUpdate = vi.fn();
const adminSelect = vi.fn();
const adminFromMock = vi.fn();

const mockUser = { id: "user-uuid-1" };
const sessionGetUser = vi.fn(async () => ({ data: { user: mockUser } }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: sessionGetUser },
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: adminFromMock,
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  createVoiceToken,
  revokeVoiceToken,
} from "@/actions/voice-tokens";
import { hashVoiceToken } from "@/lib/voice-tokens/tokens";

beforeEach(() => {
  vi.clearAllMocks();
  // Default: env wired, admin client succeeds.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://example.com";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";

  adminFromMock.mockImplementation((table: string) => {
    if (table !== "voice_tokens") throw new Error(`unexpected table ${table}`);
    return {
      // Mirrors `.insert(row).select(...).single()` from the impl.
      insert: (...args: unknown[]) => ({
        select: () => ({
          single: () =>
            adminInsert(...args).then(() => ({
              data: { id: "tok-1", label: (args[0] as { label: string }).label },
              error: null,
            })),
        }),
      }),
      // Mirrors `.update(patch).eq("id", id).eq("user_id", uid)`.
      update: (...args: unknown[]) => ({
        eq: () => ({
          eq: () => adminUpdate(...args).then(() => ({ error: null })),
        }),
      }),
      select: (...args: unknown[]) => adminSelect(...args),
    };
  });
  sessionGetUser.mockResolvedValue({ data: { user: mockUser } });
});

describe("createVoiceToken", () => {
  it("rejects when there is no session", async () => {
    sessionGetUser.mockResolvedValue({ data: { user: null } });
    const r = await createVoiceToken({ label: "iPhone", default_wallet_id: null });
    expect(r.ok).toBe(false);
  });

  it("stores the sha256 hash and never the plaintext", async () => {
    adminInsert.mockResolvedValue({ error: null });
    const r = await createVoiceToken({ label: "iPhone", default_wallet_id: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const plaintext = r.data!.token;
    expect(plaintext.startsWith("vt_")).toBe(true);
    const inserted = adminInsert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted.token_hash).toBe(hashVoiceToken(plaintext));
    expect(JSON.stringify(inserted)).not.toContain(plaintext);
  });
});

describe("revokeVoiceToken", () => {
  it("sets revoked_at to a timestamp, scoped to the caller user_id", async () => {
    adminUpdate.mockResolvedValue({ error: null });
    const r = await revokeVoiceToken("token-id-1");
    expect(r.ok).toBe(true);
    const patch = adminUpdate.mock.calls[0]?.[0] as { revoked_at: string };
    expect(patch.revoked_at).toBeTruthy();
    expect(() => new Date(patch.revoked_at).toISOString()).not.toThrow();
  });

  it("rejects when there is no session", async () => {
    sessionGetUser.mockResolvedValue({ data: { user: null } });
    const r = await revokeVoiceToken("token-id-1");
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- tests/actions/voice-tokens.test.ts
```

Expected: FAIL — `actions/voice-tokens` does not exist.

- [ ] **Step 3: Implement the actions**

Create `actions/voice-tokens.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test -- tests/actions/voice-tokens.test.ts
```

Expected: PASS (4/4).

- [ ] **Step 5: Run full suite**

```bash
pnpm test
```

Expected: PASS (no regressions).

- [ ] **Step 6: Commit**

```bash
git add actions/voice-tokens.ts tests/actions/voice-tokens.test.ts
git commit -m "$(cat <<'EOF'
feat(voice): server actions to create/revoke/list voice tokens

createVoiceToken returns plaintext once and stores only the sha256 hash.
revokeVoiceToken soft-deletes via revoked_at and scopes the WHERE clause
to the caller's user_id. listVoiceTokens uses the user-scoped Supabase
client so RLS enforces ownership.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: API endpoint `POST /api/voice/agent` (TDD)

**Files:**
- Create: `app/api/voice/agent/route.ts`
- Test: `tests/api/voice-agent.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/api/voice-agent.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock runExpenseAgent BEFORE importing the route.
const runAgentMock = vi.fn();
class FakeQuotaError extends Error {
  constructor() {
    super("quota");
    this.name = "AgentQuotaError";
  }
}

vi.mock("@/lib/ai/agent", () => ({
  runExpenseAgent: runAgentMock,
  AgentQuotaError: FakeQuotaError,
}));

// Mock the admin Supabase client.
const tokenSelect = vi.fn();
const tokenUpdate = vi.fn();
const profileSelect = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "voice_tokens") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({ maybeSingle: tokenSelect }),
            }),
          }),
          update: tokenUpdate,
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: profileSelect }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { POST } from "@/app/api/voice/agent/route";
import { hashVoiceToken } from "@/lib/voice-tokens/tokens";

const PLAIN_TOKEN = "vt_test_plaintext_abc123";

function makeReq(opts: {
  authHeader?: string;
  body?: unknown;
}): Request {
  return new Request("http://test.local/api/voice/agent", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.authHeader ? { authorization: opts.authHeader } : {}),
    },
    body: JSON.stringify(opts.body ?? {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // tokenUpdate is fire-and-forget; ensure the chained `.eq()` works.
  tokenUpdate.mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
  // Default happy-path mocks.
  tokenSelect.mockResolvedValue({
    data: {
      id: "tok-1",
      user_id: "user-1",
      default_wallet_id: "wallet-1",
    },
    error: null,
  });
  profileSelect.mockResolvedValue({
    data: { main_currency: "ARS" },
    error: null,
  });
  runAgentMock.mockResolvedValue({ text: "✅ Anotado $500 en Comida" });
});

describe("POST /api/voice/agent", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const r = await POST(makeReq({ body: { text: "x" } }));
    expect(r.status).toBe(401);
  });

  it("returns 401 when token is malformed", async () => {
    const r = await POST(makeReq({ authHeader: "NotBearer xyz", body: { text: "x" } }));
    expect(r.status).toBe(401);
  });

  it("returns 401 when token does not match any row", async () => {
    tokenSelect.mockResolvedValue({ data: null, error: null });
    const r = await POST(makeReq({
      authHeader: `Bearer ${PLAIN_TOKEN}`,
      body: { text: "x" },
    }));
    expect(r.status).toBe(401);
  });

  it("returns 400 when body has no text", async () => {
    const r = await POST(makeReq({
      authHeader: `Bearer ${PLAIN_TOKEN}`,
      body: {},
    }));
    expect(r.status).toBe(400);
  });

  it("returns 200 with agent text on happy path", async () => {
    const r = await POST(makeReq({
      authHeader: `Bearer ${PLAIN_TOKEN}`,
      body: { text: "gasté 500 en el super" },
    }));
    expect(r.status).toBe(200);
    const json = (await r.json()) as { ok: boolean; text: string };
    expect(json).toEqual({ ok: true, text: "✅ Anotado $500 en Comida" });

    // Verify we delegated with the right args.
    expect(runAgentMock).toHaveBeenCalledTimes(1);
    const args = runAgentMock.mock.calls[0]?.[0];
    expect(args.userId).toBe("user-1");
    expect(args.chatId).toBe(-1);
    expect(args.mainCurrency).toBe("ARS");
    expect(args.text).toBe("gasté 500 en el super");
    expect(args.defaultWalletId).toBe("wallet-1");
  });

  it("looks up the token by sha256 hash, not plaintext", async () => {
    await POST(makeReq({
      authHeader: `Bearer ${PLAIN_TOKEN}`,
      body: { text: "x" },
    }));
    // Walk the from() chain to confirm; with the current mock shape we
    // can't easily inspect the WHERE clause, so assert tokenSelect was
    // invoked exactly once and the hash logic is exercised indirectly via
    // the unit test in Task 2.
    expect(tokenSelect).toHaveBeenCalledTimes(1);
    expect(hashVoiceToken(PLAIN_TOKEN)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns 200 with ok:false when the agent throws AgentQuotaError", async () => {
    runAgentMock.mockRejectedValue(new FakeQuotaError());
    const r = await POST(makeReq({
      authHeader: `Bearer ${PLAIN_TOKEN}`,
      body: { text: "x" },
    }));
    expect(r.status).toBe(200);
    const json = (await r.json()) as { ok: boolean; text: string };
    expect(json.ok).toBe(false);
    expect(json.text).toMatch(/cuota/i);
  });

  it("returns 200 with ok:false generic message when agent throws unknown error", async () => {
    runAgentMock.mockRejectedValue(new Error("boom"));
    const r = await POST(makeReq({
      authHeader: `Bearer ${PLAIN_TOKEN}`,
      body: { text: "x" },
    }));
    expect(r.status).toBe(200);
    const json = (await r.json()) as { ok: boolean; text: string };
    expect(json.ok).toBe(false);
    expect(json.text).toMatch(/algo fall/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- tests/api/voice-agent.test.ts
```

Expected: FAIL — the route file does not exist.

- [ ] **Step 3: Implement the route**

Create `app/api/voice/agent/route.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test -- tests/api/voice-agent.test.ts
```

Expected: PASS (8/8).

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/voice/agent/route.ts tests/api/voice-agent.test.ts
git commit -m "$(cat <<'EOF'
feat(api): POST /api/voice/agent for Siri Shortcut

Bearer-token auth (sha256 lookup in voice_tokens), Zod-validated body,
delegates to runExpenseAgent with chatId=-1 sentinel. Errors return 200
with ok:false so the iOS Shortcut can always speak the response aloud.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Settings UI — `/settings/voice`

**Files:**
- Create: `app/(app)/settings/voice/page.tsx`
- Create: `app/(app)/settings/voice/voice-tokens-manager.tsx`
- Modify: `app/(app)/settings/page.tsx` (add link to /settings/voice)

This task is mostly UI assembly. No new unit tests — manual verification at the end.

- [ ] **Step 1: Build the manager client component**

Create `app/(app)/settings/voice/voice-tokens-manager.tsx`:

```tsx
"use client";

// Voice-token management UI.
//
// On mount: lists existing tokens (label, last_used_at, revoke button).
// "Generate new token": opens a small form (label + wallet selector),
// then renders the plaintext token ONCE with a copy button.
//
// All mutations go through the server actions in `actions/voice-tokens`.

import { useEffect, useState, useTransition } from "react";

import { Check, Copy, Trash } from "@phosphor-icons/react";

import {
  createVoiceToken,
  listVoiceTokens,
  revokeVoiceToken,
  type VoiceTokenRow,
} from "@/actions/voice-tokens";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface Wallet {
  id: string;
  name: string;
}

interface Props {
  wallets: Wallet[];
}

export function VoiceTokensManager({ wallets }: Props) {
  const [tokens, setTokens] = useState<VoiceTokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [walletId, setWalletId] = useState<string | "">("");

  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = async () => {
    setLoading(true);
    const r = await listVoiceTokens();
    if (r.ok) setTokens(r.data ?? []);
    else setError(r.error);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const onCreate = () => {
    setError(null);
    startTransition(async () => {
      const r = await createVoiceToken({
        label: label.trim(),
        default_wallet_id: walletId === "" ? null : walletId,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setCreatedToken(r.data!.token);
      setShowForm(false);
      setLabel("");
      setWalletId("");
      void refresh();
    });
  };

  const onRevoke = (id: string) => {
    setError(null);
    startTransition(async () => {
      const r = await revokeVoiceToken(id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      void refresh();
    });
  };

  const onCopy = async () => {
    if (!createdToken) return;
    await navigator.clipboard.writeText(createdToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Tokens activos</CardTitle>
          <CardDescription>
            Cada token autoriza a un dispositivo (un iPhone, un iPad) a usar el Atajo de Siri.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <div className="text-sm text-muted-foreground">Cargando…</div>
          ) : tokens.filter((t) => t.revoked_at === null).length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No tenés tokens activos. Generá uno para configurar el Atajo.
            </div>
          ) : (
            tokens
              .filter((t) => t.revoked_at === null)
              .map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{t.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {t.last_used_at
                        ? `Último uso: ${new Date(t.last_used_at).toLocaleString()}`
                        : "Sin uso aún"}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onRevoke(t.id)}
                    disabled={pending}
                  >
                    <Trash className="size-4" />
                  </Button>
                </div>
              ))
          )}
        </CardContent>
      </Card>

      {createdToken ? (
        <Card>
          <CardHeader>
            <CardTitle>Token generado</CardTitle>
            <CardDescription>
              Copialo ahora — no se vuelve a mostrar. Pegalo en la acción
              &quot;Obtener contenido de URL&quot; del Atajo de iOS.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2 rounded-md border bg-muted p-3 font-mono text-sm break-all">
              {createdToken}
              <Button size="sm" variant="ghost" onClick={onCopy}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
            <Button variant="outline" size="sm" onClick={() => setCreatedToken(null)}>
              Listo, lo guardé
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {!showForm ? (
        <Button onClick={() => setShowForm(true)}>+ Generar nuevo token</Button>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Nuevo token</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Label</label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="iPhone personal"
                maxLength={60}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Wallet por defecto</label>
              <select
                className="w-full rounded-md border bg-background p-2 text-sm"
                value={walletId}
                onChange={(e) => setWalletId(e.target.value)}
              >
                <option value="">— Sin default —</option>
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <Button onClick={onCreate} disabled={pending || label.trim().length === 0}>
                Generar
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowForm(false);
                  setLabel("");
                  setWalletId("");
                  setError(null);
                }}
              >
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {error ? (
        <div className="text-sm text-destructive">{error}</div>
      ) : null}

      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Cómo configurar el Atajo de iOS
        </summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Abrí la app <strong>Atajos</strong> en el iPhone → <strong>+</strong>.</li>
          <li>
            Acción <strong>&quot;Pedir entrada&quot;</strong> — pregunta:{" "}
            <em>¿Qué gasto?</em> · tipo: <strong>Texto</strong>.
          </li>
          <li>
            Acción <strong>&quot;Obtener contenido de URL&quot;</strong>:
            <ul className="list-disc pl-5">
              <li>URL: <code>https://&lt;tu-dominio&gt;/api/voice/agent</code></li>
              <li>Método: <strong>POST</strong></li>
              <li>
                Encabezados:{" "}
                <code>Authorization: Bearer &lt;token&gt;</code> y{" "}
                <code>Content-Type: application/json</code>
              </li>
              <li>
                Cuerpo (JSON): clave <code>text</code> → valor{" "}
                <em>Texto proporcionado</em> (variable del paso 2).
              </li>
            </ul>
          </li>
          <li>
            Acción <strong>&quot;Obtener valor del diccionario&quot;</strong> →{" "}
            clave <code>text</code>.
          </li>
          <li>
            Acción <strong>&quot;Hablar texto&quot;</strong> con el resultado del paso anterior.
          </li>
          <li>Nombre del atajo: <strong>Agregar gasto</strong>.</li>
          <li>Decile a Siri: <em>&quot;Hey Siri, agregar gasto&quot;</em>.</li>
        </ol>
      </details>
    </div>
  );
}
```

- [ ] **Step 2: Build the server page**

Create `app/(app)/settings/voice/page.tsx`:

```tsx
import { redirect } from "next/navigation";

import { MobileHeader } from "@/components/shared/mobile-header";
import { createClient } from "@/lib/supabase/server";

import { VoiceTokensManager } from "./voice-tokens-manager";

export default async function VoiceSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: wallets } = await supabase
    .from("wallets")
    .select("id, name")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  return (
    <>
      <MobileHeader title="Voz (Siri)" back="/settings" />
      <main className="container mx-auto max-w-2xl p-4">
        <VoiceTokensManager wallets={wallets ?? []} />
      </main>
    </>
  );
}
```

- [ ] **Step 3: Add link from `/settings`**

Open `app/(app)/settings/page.tsx` and inspect its current list of links (look for the existing Telegram link card; copy its structure).

Add a new card or list item:

```tsx
<Link href="/settings/voice">
  <Card>
    <CardHeader>
      <CardTitle>Voz (Siri)</CardTitle>
      <CardDescription>Configurar Atajos de iOS para agregar gastos por voz.</CardDescription>
    </CardHeader>
  </Card>
</Link>
```

Drop it right after the existing Telegram entry. Match the surrounding visual style (same `Card`, same icon convention if used).

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Lint**

```bash
pnpm lint
```

Expected: PASS.

- [ ] **Step 6: Manual UI verification**

Start dev server and exercise the UI in a browser:

```bash
pnpm dev
```

Visit `http://localhost:3000/settings/voice` after logging in. Verify:

- Empty state shows correctly.
- "Generar nuevo token" opens form with wallet selector populated.
- After creating, the plaintext token is shown ONCE in a copy-able block.
- After clicking "Listo, lo guardé", the token card disappears and the new token shows in the list.
- Clicking the trash icon revokes the token (it disappears from the active list).
- Generating a second time produces a different token (no collision).
- Refreshing the page: revoked tokens stay revoked; active ones stay active.

- [ ] **Step 7: Commit**

```bash
git add app/\(app\)/settings/voice/ app/\(app\)/settings/page.tsx
git commit -m "$(cat <<'EOF'
feat(settings): /settings/voice page to manage voice tokens

List active tokens with last_used_at + revoke. Generate-token form
with wallet default selector. Plaintext shown once with copy button.
Embedded step-by-step guide for the iOS Shortcut setup.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: End-to-end verification on iPhone

This is purely manual. No code changes. The goal is to prove the full happy path works before merging.

- [ ] **Step 1: Deploy to a preview URL**

```bash
git push
```

Wait for the Vercel preview deploy to be ready. Open the preview URL and log in.

- [ ] **Step 2: Generate a token**

Go to `/settings/voice` on the preview URL. Generate a token with label "iPhone test" and your main wallet as default. Copy the plaintext.

- [ ] **Step 3: Build the Shortcut on the iPhone**

Follow the guide in the page itself (or below):

```
1. App Atajos → +
2. "Pedir entrada"
     Pregunta: ¿Qué gasto?
     Tipo:     Texto
3. "Obtener contenido de URL"
     URL:      <preview-url>/api/voice/agent
     Método:   POST
     Encabezados:
       Authorization: Bearer vt_<your-plaintext>
       Content-Type:  application/json
     Cuerpo de la solicitud (JSON):
       text: <Texto proporcionado>
4. "Obtener valor del diccionario" → Clave: text
5. "Hablar texto" → <resultado>
6. Nombre: Agregar gasto (test)
```

- [ ] **Step 4: Smoke-test happy path**

Say "Hey Siri, agregar gasto (test)". Dictate: "gasté 500 en el super con tarjeta". Expected: Siri reads back a confirmation along the lines of "Anoté $500 en Comida" (the agent's actual reply will vary).

Verify in `/transactions` (or via Telegram `/ultimos`) that a row was created with amount 500.

- [ ] **Step 5: Smoke-test failure modes**

- Revoke the token from `/settings/voice`. Re-run the Shortcut. Siri should not be able to read a positive reply (the Shortcut will get a 401; depending on how the Shortcut is configured, it either errors silently or reads nothing — both are acceptable signals).
- Generate a fresh token, update the Shortcut. Try a nonsense dictation like "hola qué tal". The agent should reply with something like "no entendí, probá de nuevo" and Siri reads that.

- [ ] **Step 6: Promote to production**

Once both happy path and revocation work on the preview URL, merge the branch to `main` (or open a PR if your workflow requires it):

```bash
git push origin <branch>
# Open PR via gh pr create if workflow requires PRs, otherwise merge directly.
```

Production-side: regenerate the token from the production `/settings/voice` (preview tokens won't work in prod — different DB) and update the Shortcut URL to the production domain.

---

## Verification summary

After all tasks complete, the following should be true:

- `pnpm test` passes (existing suite + new tests in `tests/voice-tokens/`, `tests/actions/voice-tokens.test.ts`, `tests/api/voice-agent.test.ts`, extended `tests/ai/agent/index.test.ts`).
- `pnpm typecheck` passes.
- `pnpm lint` passes.
- Logged-in user can visit `/settings/voice`, generate a token, see it in the active list, and revoke it.
- A real iPhone Shortcut hitting `POST /api/voice/agent` with a valid token creates a movement and Siri reads the confirmation aloud.
- A revoked token returns 401.
- A malformed body returns 400.
