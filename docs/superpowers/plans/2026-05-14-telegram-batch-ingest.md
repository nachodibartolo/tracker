# Telegram Batch Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Habilitar carga de múltiples movimientos por mensaje en el bot de Telegram (bank statements, feeds de billeteras virtuales, texto libre multi-item, fotos en serie) con deduplicación automática contra `transactions` ∪ `telegram_pending`, soporte de subcategorías, y marcado opcional de transferencias internas.

**Architecture:** Aditivo sobre el modelo actual. Un batch = N filas en `telegram_pending` agrupadas por `batch_id`. Toda la lógica nueva vive en helpers puros (`lib/telegram/dedup.ts`, `wallet-resolver.ts`, `pending-batch.ts`) que los handlers consumen. El extractor AI pasa a devolver siempre `ExpenseBatchExtraction`; las funciones single quedan como wrappers thin que extraen `items[0]`.

**Tech Stack:** Next.js 15 App Router · grammY · Supabase Postgres (admin client, service-role) · Vercel AI SDK + Gemini 2.5 Flash · Zod · pnpm

**Spec:** `docs/superpowers/specs/2026-05-14-telegram-batch-ingest-design.md`

**Verification approach:** El proyecto no tiene framework de tests. Cada tarea valida con `pnpm typecheck`, `pnpm lint` y verificación manual via dev server / Telegram donde aplique. Para helpers puros (dedup, payee normalization) incluimos scripts ad-hoc en `scripts/` que se pueden borrar después.

---

## File structure

**Crear:**
- `supabase/migrations/0010_telegram_pending_batch.sql`
- `lib/telegram/wallet-resolver.ts` — match de caption → wallet
- `lib/telegram/dedup.ts` — algoritmo pairing 1:1
- `lib/telegram/pending-batch.ts` — insert/load/update de filas batch
- `lib/telegram/preview-batch.ts` — render del mensaje resumido
- `lib/telegram/chat-state.ts` — upsert/lookup de `telegram_chat_state`
- `lib/telegram/handlers/batch.ts` — callback handler para los prefijos `b*`
- `scripts/test-dedup.ts` — script ad-hoc, borrable

**Modificar:**
- `lib/supabase/database.types.ts` — agregar columnas nuevas y tabla `telegram_chat_state`
- `lib/ai/schemas.ts` — renombrar a `ExpenseItemSchema`, agregar campos, nuevo `ExpenseBatchExtractionSchema`
- `lib/ai/extract-expense.ts` — nuevas funciones `extractBatch*` + wrappers thin
- `lib/telegram/category-resolver.ts` — soporte de `subHint`
- `lib/telegram/handlers/photo.ts` — usa batch flow
- `lib/telegram/handlers/text.ts` — intercepta modos exclude/transfer + usa batch flow
- `lib/telegram/handlers/voice.ts` — usa batch flow
- `lib/telegram/handlers/confirm.ts` — agrega prefijos legacy intactos, batch handler aparte
- `lib/telegram/handlers/index.ts` — registra el nuevo handler

---

## Wave A — Data model

### Task A1: Migración SQL

**Files:**
- Create: `supabase/migrations/0010_telegram_pending_batch.sql`

- [ ] **Step 1: Crear el archivo de migración**

```sql
-- Wave 5 · Telegram batch ingest.
--
-- Extiende `telegram_pending` con columnas para agrupar items de un mismo
-- batch (screenshot, texto multi-item) y trackear estado por item: si es
-- duplicado de una tx existente, si el AI sospecha que es un transfer
-- interno, si el usuario lo excluyó manualmente, y a qué wallet contraparte
-- apunta cuando se marca como transfer.
--
-- También crea `telegram_chat_state`: una mini-tabla key-value por chat
-- usada para implementar "modo exclusión" y "modo transfer" sin
-- conversations de grammY. Expira en 2 minutos.

alter table telegram_pending
  add column batch_id uuid,
  add column batch_index int,
  add column is_duplicate boolean not null default false,
  add column transfer_hint boolean not null default false,
  add column excluded boolean not null default false,
  add column telegram_message_id bigint,
  add column duplicate_of_tx_id uuid references transactions(id) on delete set null,
  add column counterpart_wallet_id uuid references wallets(id) on delete set null;

create index idx_telegram_pending_batch on telegram_pending(batch_id)
  where batch_id is not null;

create index idx_telegram_pending_msg on telegram_pending(telegram_chat_id, telegram_message_id)
  where telegram_message_id is not null;

create table telegram_chat_state (
  telegram_chat_id bigint primary key,
  awaiting_exclude_batch_id uuid,
  awaiting_transfer_batch_id uuid,
  set_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 minutes'
);

alter table telegram_chat_state enable row level security;
-- service-role only, sin políticas públicas
```

- [ ] **Step 2: Validar el SQL parseando contra Postgres local**

Run: `pnpm supabase db reset --linked=false` (si el usuario tiene Supabase local), o aplicar contra el proyecto remoto via MCP.

Expected: migración corre sin errores. La tabla `telegram_pending` muestra las 8 columnas nuevas; `telegram_chat_state` existe.

> **Nota:** si el usuario no tiene Supabase local levantado, aplicar via el panel de Supabase (Dashboard → SQL Editor) o vía el MCP `apply_migration`. NO commitear hasta que la migración corra.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0010_telegram_pending_batch.sql
git commit -m "feat(db): batch ingest schema for Telegram pending"
```

### Task A2: Actualizar `database.types.ts`

**Files:**
- Modify: `lib/supabase/database.types.ts:158-211` (telegram_pending block) y agregar nueva tabla telegram_chat_state después de `telegram_users`

- [ ] **Step 1: Agregar las columnas nuevas al bloque `telegram_pending`**

Reemplazar el bloque actual con (los nombres y opcionalidades importan):

```ts
      telegram_pending: {
        Row: {
          batch_id: string | null
          batch_index: number | null
          counterpart_wallet_id: string | null
          created_at: string
          duplicate_of_tx_id: string | null
          excluded: boolean
          expires_at: string
          extraction: Json
          id: string
          is_duplicate: boolean
          photo_path: string | null
          source: Database["public"]["Enums"]["tx_source"]
          suggested_category_id: string | null
          suggested_wallet_id: string | null
          telegram_chat_id: number
          telegram_message_id: number | null
          transfer_hint: boolean
          user_id: string
        }
        Insert: {
          batch_id?: string | null
          batch_index?: number | null
          counterpart_wallet_id?: string | null
          created_at?: string
          duplicate_of_tx_id?: string | null
          excluded?: boolean
          expires_at?: string
          extraction: Json
          id?: string
          is_duplicate?: boolean
          photo_path?: string | null
          source: Database["public"]["Enums"]["tx_source"]
          suggested_category_id?: string | null
          suggested_wallet_id?: string | null
          telegram_chat_id: number
          telegram_message_id?: number | null
          transfer_hint?: boolean
          user_id: string
        }
        Update: {
          batch_id?: string | null
          batch_index?: number | null
          counterpart_wallet_id?: string | null
          created_at?: string
          duplicate_of_tx_id?: string | null
          excluded?: boolean
          expires_at?: string
          extraction?: Json
          id?: string
          is_duplicate?: boolean
          photo_path?: string | null
          source?: Database["public"]["Enums"]["tx_source"]
          suggested_category_id?: string | null
          suggested_wallet_id?: string | null
          telegram_chat_id?: number
          telegram_message_id?: number | null
          transfer_hint?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_pending_counterpart_wallet_id_fkey"
            columns: ["counterpart_wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_pending_duplicate_of_tx_id_fkey"
            columns: ["duplicate_of_tx_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_pending_suggested_category_id_fkey"
            columns: ["suggested_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_pending_suggested_wallet_id_fkey"
            columns: ["suggested_wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
```

- [ ] **Step 2: Agregar la tabla `telegram_chat_state`**

Insertar después del bloque `telegram_users` (o donde corresponda alfabéticamente en el listado de tablas):

```ts
      telegram_chat_state: {
        Row: {
          awaiting_exclude_batch_id: string | null
          awaiting_transfer_batch_id: string | null
          expires_at: string
          set_at: string
          telegram_chat_id: number
        }
        Insert: {
          awaiting_exclude_batch_id?: string | null
          awaiting_transfer_batch_id?: string | null
          expires_at?: string
          set_at?: string
          telegram_chat_id: number
        }
        Update: {
          awaiting_exclude_batch_id?: string | null
          awaiting_transfer_batch_id?: string | null
          expires_at?: string
          set_at?: string
          telegram_chat_id?: number
        }
        Relationships: []
      }
```

- [ ] **Step 3: Validar**

Run: `pnpm typecheck`
Expected: 0 errores (los handlers actuales no acceden a las columnas nuevas, no debería romper nada).

- [ ] **Step 4: Commit**

```bash
git add lib/supabase/database.types.ts
git commit -m "types: regenerate telegram_pending + telegram_chat_state"
```

---

## Wave B — Schema Zod

### Task B1: Refactor `lib/ai/schemas.ts`

**Files:**
- Modify: `lib/ai/schemas.ts` (completo)

- [ ] **Step 1: Reescribir el archivo**

```ts
import { z } from "zod";

/**
 * Canonical category-hint slugs. Lowercase, unaccented, hyphen-free. These
 * map 1:1 to the seeded category names in
 * `supabase/migrations/0004_seed_categories.sql` after normalizing case and
 * accents. Downstream matchers should rely on this list as the source of truth.
 */
export const CATEGORY_HINTS = [
  // expense
  "comida",
  "transporte",
  "servicios",
  "hogar",
  "salud",
  "entretenimiento",
  "compras",
  "educacion",
  "viajes",
  "otros",
  // income
  "salario",
  "freelance",
  "inversiones",
] as const;

export type CategoryHint = (typeof CATEGORY_HINTS)[number];

/**
 * One movement extracted from any input source. The bot persists one row in
 * `telegram_pending` per item; a batch of N items shares a `batch_id`.
 */
export const ExpenseItemSchema = z.object({
  type: z
    .enum(["expense", "income", "unknown"])
    .describe(
      "expense = dinero que sale; income = dinero que entra; unknown = no se puede determinar.",
    ),
  amount: z
    .number()
    .positive()
    .multipleOf(0.01)
    .nullable()
    .describe("Monto positivo con hasta dos decimales. null si no es claro."),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/u, "ISO 4217 de tres letras en mayúsculas")
    .nullable()
    .describe(
      "Código ISO 4217 en mayúsculas (ej: ARS, USD, EUR). null si no se puede inferir.",
    ),
  payee: z
    .string()
    .max(80)
    .nullable()
    .describe("Comercio o contraparte (ej: 'Starbucks', 'Edesur'). Máx 80 chars."),
  description: z
    .string()
    .max(200)
    .nullable()
    .describe("Resumen corto o concepto crudo (ej: 'CPA. PEDIDOSYA MI BARRIO'). Máx 200 chars."),
  category_hint: z
    .enum(CATEGORY_HINTS)
    .nullable()
    .describe(
      "Slug de categoría top-level sugerida. Debe ser uno de la lista canónica o null.",
    ),
  subcategory_hint: z
    .string()
    .max(40)
    .nullable()
    .describe(
      "Texto libre, una palabra/frase en minúsculas (ej: 'café', 'supermercado', 'comida rápida'). null si no se puede afinar.",
    ),
  occurred_at: z
    .string()
    .datetime({ offset: true })
    .nullable()
    .describe(
      "Fecha y hora ISO 8601 cuando ocurrió. null = usar 'ahora' al persistir.",
    ),
  transfer_hint: z
    .boolean()
    .describe(
      "true si el concepto sugiere transferencia interna entre wallets propias (DEBIN, TRANSFERENCIA PUSH, INGRESO DE DINERO, CREDITO INMEDIATO, etc.).",
    ),
  external_id: z
    .string()
    .max(120)
    .nullable()
    .describe("ID externo si la fuente lo muestra (ej: número de comprobante MP). null si no aparece."),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Confianza de la extracción del item, entre 0 y 1."),
});

export type ExpenseItem = z.infer<typeof ExpenseItemSchema>;

/**
 * Backwards-compat alias. Old code (handlers single, web app) imports
 * `ExpenseExtraction`. We keep the type around so the diff stays surgical.
 */
export const ExpenseExtractionSchema = ExpenseItemSchema;
export type ExpenseExtraction = ExpenseItem;

export const SourceKindSchema = z.enum([
  "receipt",
  "bank_statement",
  "wallet_app_feed",
  "free_text",
  "unknown",
]);

export type SourceKind = z.infer<typeof SourceKindSchema>;

/**
 * Output of the batch extractor. `items=[]` plus `source_kind='unknown'`
 * means the AI couldn't make sense of the input. A receipt (1 item) and a
 * bank statement (24 items) share this shape — handlers branch on
 * `items.length`.
 */
export const ExpenseBatchExtractionSchema = z.object({
  source_kind: SourceKindSchema,
  items: z.array(ExpenseItemSchema).max(100),
});

export type ExpenseBatchExtraction = z.infer<typeof ExpenseBatchExtractionSchema>;
```

- [ ] **Step 2: Validar**

Run: `pnpm typecheck`
Expected: 0 errores (los imports de `ExpenseExtraction` siguen funcionando vía el alias).

- [ ] **Step 3: Commit**

```bash
git add lib/ai/schemas.ts
git commit -m "feat(ai): batch extraction schema + transfer/subcategory hints"
```

---

## Wave C — AI extractor con batch

### Task C1: Constantes del prompt

**Files:**
- Modify: `lib/ai/extract-expense.ts` — agregar al top después de los imports

- [ ] **Step 1: Agregar bloque de constantes**

Insertar después de los imports y antes de `AiExtractionError`:

```ts
/**
 * Internal-transfer hint keywords. The AI marks `transfer_hint=true` when a
 * concept contains any of these substrings (case-insensitive, accent-insensitive).
 * Listed in the system prompt so the model has explicit guidance instead of
 * inferring from context.
 */
const INTERNAL_TRANSFER_HINTS = [
  // homebanking
  "DEBIN",
  "TRANSFERENCIA PUSH",
  "CREDITO INMEDIATO",
  "DEB PREA",
  "PAGO PERSONAL",
  "TRANSFERENCIA RECIBIDA",
  "TRANSFERENCIA ENVIADA",
  // wallet apps
  "INGRESO DE DINERO",
];

/**
 * Argentine merchant normalization patterns. Listed in the system prompt so
 * the AI normalizes payees and categories consistently. Each entry: pattern
 * (substring match, case-insensitive) → payee, category_hint, subcategory_hint.
 */
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

/**
 * Tz-aware "today" for the AI. Used in the system prompt so the model can
 * resolve relative dates and decide the year for DD/MM/AA fields.
 */
function currentDateLine(): string {
  const now = new Date();
  const iso = now.toISOString();
  const yearLocal = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(now);
  return `currentDate (UTC ISO): ${iso}. Current year in Argentina: ${yearLocal.slice(0, 4)}.`;
}
```

- [ ] **Step 2: Validar**

Run: `pnpm typecheck`
Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/extract-expense.ts
git commit -m "feat(ai): add internal-transfer + payee normalization constants"
```

### Task C2: Funciones batch

**Files:**
- Modify: `lib/ai/extract-expense.ts`

- [ ] **Step 1: Reemplazar el helper `baseSchemaInstructions` y agregar `batchInstructions`**

Reemplazar la función actual `baseSchemaInstructions` con esta versión:

```ts
function baseSchemaInstructions(defaultCurrency: string): string {
  return [
    "Devolvé SIEMPRE un objeto JSON que matchee el schema provisto. No agregues campos extra.",
    `Default currency: ${defaultCurrency}. Si no se menciona explícitamente otra moneda, usá '${defaultCurrency}'.`,
    "Los 'amount' deben ser positivos aunque sean gastos. El signo lo determina 'type'.",
    `Los slugs válidos para 'category_hint' son exactamente: ${CATEGORY_LIST}. Usá null si ninguno aplica.`,
    "'subcategory_hint' es texto libre: una sola palabra/frase en minúsculas (ej: 'café', 'supermercado', 'comida rápida'). null si no se puede afinar.",
    "Si la fecha no aparece explícita, devolvé 'occurred_at' = null (el sistema usará 'ahora').",
    "Si solo hay fecha sin hora (típico bank statement DD/MM/AA), devolvé 'occurred_at' con hora 12:00:00-03:00.",
    "'confidence' refleja qué tan segura está la extracción (0 = adivinanza, 1 = totalmente claro).",
    "Si el input no parece un gasto/ingreso, devolvé items=[] y source_kind='unknown'.",
    "",
    "Hints de transferencia interna (marcar transfer_hint=true si el concepto contiene alguno de estos):",
    INTERNAL_TRANSFER_HINTS.map((h) => `  - ${h}`).join("\n"),
    "",
    "Normalización de payees argentinos:",
    ARGENTINE_PAYEES.trim(),
    "",
    "Si no matchea ningún payee conocido: limpiá prefijos (CPA., DEB, números) y dejá el resto como payee.",
    "",
    currentDateLine(),
  ].join("\n");
}

function batchInstructions(): string {
  return [
    "Detectá primero source_kind:",
    "  - receipt: foto de ticket/recibo con UN total final → items con 1 elemento.",
    "  - bank_statement: tabla con columnas Fecha/Concepto/Débitos/Créditos → items por cada fila con monto.",
    "  - wallet_app_feed: feed estilo Mercado Pago/Modo/Ualá con avatares por movimiento → items por cada movimiento listado.",
    "  - free_text: texto narrando uno o más gastos → items por cada gasto/ingreso mencionado.",
    "  - unknown: nada de lo anterior → items=[].",
    "",
    "Anti-alucinación:",
    "  - No inventes filas. Si una fila no tiene débito ni crédito visibles, omitila.",
    "  - Si el screenshot está cortado y la última fila parece incompleta, omitila.",
    "  - No extraigas balances (Saldo) como movimientos.",
    "  - El número de items DEBE coincidir con lo que se ve en pantalla.",
  ].join("\n");
}
```

- [ ] **Step 2: Agregar las funciones batch al final del archivo**

```ts
// =============================================================================
// Batch extractors — return ExpenseBatchExtraction with N items.
// =============================================================================

export async function extractBatchFromText(
  text: string,
  defaultCurrency: string,
): Promise<ExpenseBatchExtraction> {
  requireGoogleAi();

  const system = [
    "Sos un extractor de gastos personales para un argentino. Recibís texto libre en español rioplatense que puede contener UN gasto o VARIOS (ej: 'gasté 200 en café y 1500 en uber, y cobré 80k de freelance').",
    "Extraé TODOS los movimientos mencionados. Cada uno es un item del array.",
    batchInstructions(),
    baseSchemaInstructions(defaultCurrency),
  ].join("\n");

  try {
    const { object } = await generateObject({
      model: geminiFlash,
      schema: ExpenseBatchExtractionSchema,
      system,
      prompt: text,
      temperature: 0,
    });
    return object;
  } catch (err) {
    throw new AiExtractionError(
      "text",
      err instanceof Error ? err.message : "Failed to extract batch from text",
      { cause: err },
    );
  }
}

export async function extractBatchFromImage(
  image: BinaryInput,
  defaultCurrency: string,
): Promise<ExpenseBatchExtraction> {
  requireGoogleAi();

  const system = [
    "Recibís una imagen que puede ser: un ticket/recibo (UN movimiento), una tabla de homebanking (varias filas con Fecha/Concepto/Débitos/Créditos), o un feed de billetera virtual estilo Mercado Pago/Modo/Ualá (lista de actividades por día).",
    "Identificá qué tipo de imagen es (source_kind) y extraé TODOS los movimientos que aparecen.",
    batchInstructions(),
    baseSchemaInstructions(defaultCurrency),
  ].join("\n");

  try {
    const { object } = await generateObject({
      model: geminiFlash,
      schema: ExpenseBatchExtractionSchema,
      system,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              image: image.data,
              mediaType: image.mimeType,
            },
          ],
        },
      ],
      temperature: 0,
    });
    return object;
  } catch (err) {
    throw new AiExtractionError(
      "image",
      err instanceof Error ? err.message : "Failed to extract batch from image",
      { cause: err },
    );
  }
}

export async function extractBatchFromAudio(
  audio: BinaryInput,
  defaultCurrency: string,
): Promise<ExpenseBatchExtraction> {
  requireGoogleAi();

  const system = [
    "Recibís audios cortos en español rioplatense narrando uno o más gastos.",
    "Transcribí mentalmente y extraé cada movimiento mencionado.",
    batchInstructions(),
    baseSchemaInstructions(defaultCurrency),
  ].join("\n");

  try {
    const { object } = await generateObject({
      model: geminiFlash,
      schema: ExpenseBatchExtractionSchema,
      system,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "file",
              data: audio.data,
              mediaType: audio.mimeType,
            },
          ],
        },
      ],
      temperature: 0,
    });
    return object;
  } catch (err) {
    throw new AiExtractionError(
      "audio",
      err instanceof Error ? err.message : "Failed to extract batch from audio",
      { cause: err },
    );
  }
}

const UNKNOWN_ITEM: ExpenseItem = {
  type: "unknown",
  amount: null,
  currency: null,
  payee: null,
  description: null,
  category_hint: null,
  subcategory_hint: null,
  occurred_at: null,
  transfer_hint: false,
  external_id: null,
  confidence: 0,
};
```

- [ ] **Step 3: Agregar `import type { ExpenseItem }` al header**

Modificar la línea de imports al top del archivo para que incluya los tipos nuevos:

```ts
import {
  CATEGORY_HINTS,
  ExpenseBatchExtractionSchema,
  ExpenseItemSchema,
  type ExpenseBatchExtraction,
  type ExpenseItem,
  type ExpenseExtraction,
} from "./schemas";
```

(El `ExpenseExtractionSchema` se elimina del import porque se reemplaza por `ExpenseItemSchema`; `ExpenseExtraction` queda solo como type alias para los wrappers.)

- [ ] **Step 4: Refactor de las funciones single a wrappers thin**

Reemplazar las funciones existentes `extractFromText`, `extractFromImage`, `extractFromAudio` con estos wrappers:

```ts
/**
 * Wrapper thin: delega en `extractBatchFromText` y devuelve el primer item
 * para mantener compatibilidad con código que esperaba un solo movimiento.
 */
export async function extractFromText(
  text: string,
  defaultCurrency: string,
): Promise<ExpenseExtraction> {
  const batch = await extractBatchFromText(text, defaultCurrency);
  return batch.items[0] ?? UNKNOWN_ITEM;
}

export async function extractFromImage(
  image: BinaryInput,
  defaultCurrency: string,
): Promise<ExpenseExtraction> {
  const batch = await extractBatchFromImage(image, defaultCurrency);
  return batch.items[0] ?? UNKNOWN_ITEM;
}

export async function extractFromAudio(
  audio: BinaryInput,
  defaultCurrency: string,
): Promise<ExpenseExtraction> {
  const batch = await extractBatchFromAudio(audio, defaultCurrency);
  return batch.items[0] ?? UNKNOWN_ITEM;
}
```

Borrar el código viejo de esas tres funciones (el que llamaba a `generateObject` con `ExpenseExtractionSchema`).

- [ ] **Step 5: Validar**

Run: `pnpm typecheck`
Expected: 0 errores.

Run: `pnpm lint lib/ai/extract-expense.ts`
Expected: 0 errores.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/extract-expense.ts
git commit -m "feat(ai): batch extractors + thin single wrappers"
```

---

## Wave D — Category resolver con subcategoría

### Task D1: Extender `resolveCategory`

**Files:**
- Modify: `lib/telegram/category-resolver.ts`

- [ ] **Step 1: Actualizar la firma y el cuerpo de `resolveCategory`**

Reemplazar la función `resolveCategory` (líneas ~70-128) con:

```ts
export async function resolveCategory(
  supabase: TypedClient,
  userId: string,
  type: "expense" | "income",
  hint: string | null,
  subHint?: string | null,
): Promise<ResolvedCategory> {
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, parent_id, type")
    .eq("user_id", userId)
    .eq("type", type);

  if (error || !data || data.length === 0) {
    return { id: null, label: "Sin categoría" };
  }

  const rows = data as CategoryRow[];
  const byId = new Map<string, CategoryRow>();
  for (const r of rows) byId.set(r.id, r);

  // Resolve top-level first (existing logic). If the hint maps to a sub
  // directly (rare; the AI normally picks top-level), we still return it.
  let resolved: CategoryRow | undefined;

  if (hint) {
    const h = normalise(hint);
    resolved = rows.find((r) => normalise(r.name) === h);
    if (!resolved) {
      resolved = rows.find((r) => {
        const n = normalise(r.name);
        return n.includes(h) || h.includes(n);
      });
    }
  }

  if (!resolved) {
    resolved = rows.find(
      (r) => normalise(r.name) === normalise(fallbackName(type)),
    );
  }

  if (!resolved) {
    resolved = rows.find((r) => r.parent_id === null) ?? rows[0];
  }

  if (!resolved) {
    return { id: null, label: "Sin categoría" };
  }

  // If we have a sub-hint and the resolved top-level has children, try to
  // refine. Same exact/substring matching as the top-level pass, scoped to
  // the children of `resolved`.
  if (subHint && resolved.parent_id === null) {
    const sub = normalise(subHint);
    const children = rows.filter((r) => r.parent_id === resolved!.id);
    let subMatch = children.find((c) => normalise(c.name) === sub);
    if (!subMatch) {
      subMatch = children.find((c) => {
        const n = normalise(c.name);
        return n.includes(sub) || sub.includes(n);
      });
    }
    if (subMatch) {
      return { id: subMatch.id, label: labelFor(subMatch, byId) };
    }
  }

  return { id: resolved.id, label: labelFor(resolved, byId) };
}
```

- [ ] **Step 2: Validar**

Run: `pnpm typecheck`
Expected: 0 errores. Los callers actuales que pasan 4 args siguen funcionando (subHint es optional).

- [ ] **Step 3: Commit**

```bash
git add lib/telegram/category-resolver.ts
git commit -m "feat(telegram): resolveCategory supports subcategory hint"
```

---

## Wave E — Wallet resolver helper

### Task E1: Crear `lib/telegram/wallet-resolver.ts`

**Files:**
- Create: `lib/telegram/wallet-resolver.ts`

- [ ] **Step 1: Crear el archivo**

```ts
// Helper para resolver a qué wallet del usuario van los movimientos de un
// batch. Si el mensaje trae caption (ej: "nacion", "mp"), matchea por nombre
// de wallet — normalizado igual que `category-resolver`. Si no hay caption,
// usa la default. Si nada de eso resuelve, devuelve "ask" con candidatos.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;

export interface WalletCandidate {
  id: string;
  name: string;
  currency: string;
}

export type WalletResolution =
  | { kind: "resolved"; wallet: WalletCandidate }
  | { kind: "ask"; candidates: WalletCandidate[] }
  | { kind: "none" };

function normalise(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export async function resolveWalletFromCaption(
  supabase: TypedClient,
  userId: string,
  caption: string | undefined | null,
  defaultWalletId: string | null,
): Promise<WalletResolution> {
  const { data, error } = await supabase
    .from("wallets")
    .select("id, name, currency")
    .eq("user_id", userId)
    .eq("archived", false)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error || !data || data.length === 0) {
    return { kind: "none" };
  }

  const wallets = data as WalletCandidate[];
  const cap = caption ? normalise(caption) : "";

  if (cap) {
    const exact = wallets.filter((w) => normalise(w.name) === cap);
    if (exact.length === 1) return { kind: "resolved", wallet: exact[0] };

    const substring = wallets.filter((w) => {
      const n = normalise(w.name);
      return n.includes(cap) || cap.includes(n);
    });
    if (substring.length === 1) {
      return { kind: "resolved", wallet: substring[0] };
    }
    if (substring.length > 1) {
      return { kind: "ask", candidates: substring };
    }
    // Caption non-empty but no match → ask among all wallets.
    return { kind: "ask", candidates: wallets };
  }

  // No caption: try default, fall back to ask if there are multiple wallets.
  if (defaultWalletId) {
    const def = wallets.find((w) => w.id === defaultWalletId);
    if (def) return { kind: "resolved", wallet: def };
  }
  if (wallets.length === 1) {
    return { kind: "resolved", wallet: wallets[0] };
  }
  return { kind: "ask", candidates: wallets };
}
```

- [ ] **Step 2: Validar**

Run: `pnpm typecheck`
Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add lib/telegram/wallet-resolver.ts
git commit -m "feat(telegram): wallet resolver from caption"
```

---

## Wave F — Dedup pairing 1:1

### Task F1: Crear `lib/telegram/dedup.ts`

**Files:**
- Create: `lib/telegram/dedup.ts`

- [ ] **Step 1: Crear el archivo**

```ts
// Dedup pairing 1:1.
//
// Para un batch recién extraído, marca cuáles items son duplicados de
// transacciones ya cargadas (o de pendings de otros batches) y a cuál
// candidato apuntan exactamente. Pairing 1:1 evita falsos positivos cuando
// hay items legítimamente repetidos el mismo día (ej: dos cafés de $5000).
//
// La consulta SQL trae candidatos de:
//   1. transactions confirmadas (mismo user/wallet, ventana ±1 día)
//   2. telegram_pending no excluidas/expiradas (mismo user/wallet, otro batch_id)
//
// La tolerancia horaria es ±1 hora. Si el item no tiene hora, matchea cualquier
// hora del día.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ExpenseItem } from "@/lib/ai/schemas";
import type { Database } from "@/lib/supabase/database.types";

type AdminClient = SupabaseClient<Database>;

export interface DedupCandidate {
  ref_id: string;
  kind: "tx" | "pending";
  type: "expense" | "income";
  amount: number;
  occurred_at: string; // ISO timestamp
}

export interface DedupResult {
  batch_index: number;
  is_duplicate: boolean;
  duplicate_of_tx_id: string | null;
}

const HOUR_MS = 60 * 60 * 1000;
const TZ = "America/Argentina/Buenos_Aires";

function dateLocal(iso: string): string {
  // Returns YYYY-MM-DD in America/Argentina/Buenos_Aires for bucketing.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date(iso));
}

function bucketKey(dateStr: string, amount: number, type: string): string {
  return `${dateStr}::${amount.toFixed(2)}::${type}`;
}

/**
 * Pure function: emparejamiento 1:1 entre items y candidatos.
 *
 * Para cada item (en orden temporal), busca un candidato no consumido en
 * el mismo bucket (fecha+monto+tipo). Si el item tiene hora, exige
 * |item.time - cand.time| ≤ 1h. Cuando hace match, marca el item como
 * duplicado y consume el candidato (no se puede reusar).
 */
export function pairItems(
  items: ExpenseItem[],
  candidates: DedupCandidate[],
): DedupResult[] {
  const byBucket = new Map<string, DedupCandidate[]>();
  for (const c of candidates) {
    const key = bucketKey(dateLocal(c.occurred_at), c.amount, c.type);
    const list = byBucket.get(key) ?? [];
    list.push(c);
    byBucket.set(key, list);
  }

  // Order items so earliest extracted match consumes earliest candidate first.
  const ordered = items
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => {
      const ta = a.item.occurred_at ?? "";
      const tb = b.item.occurred_at ?? "";
      return ta.localeCompare(tb);
    });

  const consumed = new Set<string>();
  const out: DedupResult[] = items.map((_, idx) => ({
    batch_index: idx,
    is_duplicate: false,
    duplicate_of_tx_id: null,
  }));

  for (const { item, idx } of ordered) {
    if (item.amount == null) continue;
    if (item.type !== "expense" && item.type !== "income") continue;
    const itemIso = item.occurred_at;
    const itemDate = itemIso ? dateLocal(itemIso) : null;
    if (!itemDate) continue;

    const bucket = byBucket.get(bucketKey(itemDate, item.amount, item.type));
    if (!bucket) continue;

    const itemHasTime = itemIso !== null && !itemIso.endsWith("T12:00:00-03:00");
    let match: DedupCandidate | undefined;

    for (const c of bucket) {
      if (consumed.has(c.ref_id)) continue;
      if (itemHasTime && itemIso) {
        const diff = Math.abs(new Date(itemIso).getTime() - new Date(c.occurred_at).getTime());
        if (diff > HOUR_MS) continue;
      }
      match = c;
      break;
    }

    if (match) {
      consumed.add(match.ref_id);
      out[idx] = {
        batch_index: idx,
        is_duplicate: true,
        duplicate_of_tx_id: match.kind === "tx" ? match.ref_id : null,
      };
    }
  }

  return out;
}

/**
 * Fetch candidates from `transactions ∪ telegram_pending` and run the
 * pairing. Returns one DedupResult per item, aligned by batch_index.
 */
export async function deduplicateBatch(
  supabase: AdminClient,
  userId: string,
  walletId: string,
  items: ExpenseItem[],
  excludeBatchId: string,
): Promise<DedupResult[]> {
  if (items.length === 0) return [];

  const dates = items
    .map((i) => i.occurred_at)
    .filter((d): d is string => typeof d === "string");
  if (dates.length === 0) {
    return items.map((_, idx) => ({
      batch_index: idx,
      is_duplicate: false,
      duplicate_of_tx_id: null,
    }));
  }
  const sorted = [...dates].sort();
  const minDate = new Date(sorted[0]);
  minDate.setUTCDate(minDate.getUTCDate() - 1);
  const maxDate = new Date(sorted[sorted.length - 1]);
  maxDate.setUTCDate(maxDate.getUTCDate() + 1);

  // Transactions
  const { data: txRows, error: txErr } = await supabase
    .from("transactions")
    .select("id, type, amount, occurred_at")
    .eq("user_id", userId)
    .eq("wallet_id", walletId)
    .in("type", ["expense", "income"])
    .gte("occurred_at", minDate.toISOString())
    .lte("occurred_at", maxDate.toISOString());

  if (txErr) {
    console.error("[telegram/dedup] tx fetch failed", txErr);
  }

  // Other pending batches.
  const { data: pendingRows, error: pErr } = await supabase
    .from("telegram_pending")
    .select("id, extraction, created_at")
    .eq("user_id", userId)
    .eq("suggested_wallet_id", walletId)
    .eq("excluded", false)
    .gt("expires_at", new Date().toISOString())
    .neq("batch_id", excludeBatchId);

  if (pErr) {
    console.error("[telegram/dedup] pending fetch failed", pErr);
  }

  const candidates: DedupCandidate[] = [];
  for (const r of txRows ?? []) {
    if (r.type !== "expense" && r.type !== "income") continue;
    candidates.push({
      ref_id: r.id,
      kind: "tx",
      type: r.type,
      amount: Number(r.amount),
      occurred_at: r.occurred_at,
    });
  }
  for (const r of pendingRows ?? []) {
    const ex = r.extraction as Record<string, unknown>;
    const t = ex.type;
    const amt = ex.amount;
    const occ = ex.occurred_at ?? r.created_at;
    if ((t !== "expense" && t !== "income") || typeof amt !== "number" || typeof occ !== "string") continue;
    candidates.push({
      ref_id: r.id,
      kind: "pending",
      type: t,
      amount: amt,
      occurred_at: occ,
    });
  }

  return pairItems(items, candidates);
}
```

- [ ] **Step 2: Validar**

Run: `pnpm typecheck`
Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add lib/telegram/dedup.ts
git commit -m "feat(telegram): dedup pairing 1:1 against tx + pending"
```

### Task F2: Smoke test del pairing puro

**Files:**
- Create: `scripts/test-dedup.ts` (borrable después)

- [ ] **Step 1: Crear el script**

```ts
// Smoke test del algoritmo pairItems. No es un test formal — ejecuta casos
// y compara con esperado. Borrable después.
//
// Run: pnpm tsx scripts/test-dedup.ts

import { pairItems, type DedupCandidate } from "../lib/telegram/dedup";
import type { ExpenseItem } from "../lib/ai/schemas";

function item(amount: number, iso: string, type: "expense" | "income" = "expense"): ExpenseItem {
  return {
    type,
    amount,
    currency: "ARS",
    payee: null,
    description: null,
    category_hint: null,
    subcategory_hint: null,
    occurred_at: iso,
    transfer_hint: false,
    external_id: null,
    confidence: 0.9,
  };
}

function cand(id: string, amount: number, iso: string): DedupCandidate {
  return { ref_id: id, kind: "tx", type: "expense", amount, occurred_at: iso };
}

let pass = 0, fail = 0;

function check(name: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.error(`✗ ${name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
  }
}

// Case 1: no candidates → nothing duplicated
check(
  "no candidates",
  pairItems([item(100, "2026-05-13T15:00:00-03:00")], []).map((r) => r.is_duplicate),
  [false],
);

// Case 2: exact match same hour
check(
  "exact same hour",
  pairItems(
    [item(100, "2026-05-13T15:00:00-03:00")],
    [cand("t1", 100, "2026-05-13T15:00:00-03:00")],
  ).map((r) => r.is_duplicate),
  [true],
);

// Case 3: within 1h tolerance
check(
  "within tolerance",
  pairItems(
    [item(100, "2026-05-13T15:00:00-03:00")],
    [cand("t1", 100, "2026-05-13T15:45:00-03:00")],
  ).map((r) => r.is_duplicate),
  [true],
);

// Case 4: outside 1h tolerance
check(
  "outside tolerance",
  pairItems(
    [item(100, "2026-05-13T15:00:00-03:00")],
    [cand("t1", 100, "2026-05-13T17:00:00-03:00")],
  ).map((r) => r.is_duplicate),
  [false],
);

// Case 5: two items, one candidate → only first marked dup
check(
  "two items one candidate",
  pairItems(
    [
      item(100, "2026-05-13T10:00:00-03:00"),
      item(100, "2026-05-13T15:00:00-03:00"),
    ],
    [cand("t1", 100, "2026-05-13T10:00:00-03:00")],
  ).map((r) => r.is_duplicate),
  [true, false],
);

// Case 6: only date (12:00 marker) matches any hour same day
check(
  "no-time item matches any hour",
  pairItems(
    [item(100, "2026-05-13T12:00:00-03:00")],
    [cand("t1", 100, "2026-05-13T22:00:00-03:00")],
  ).map((r) => r.is_duplicate),
  [true],
);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: Instalar `tsx` si no está**

Run: `pnpm dlx tsx --version` (verifica que está disponible vía dlx).

> Si no está disponible vía dlx, `pnpm add -D tsx` y agregarlo a devDependencies. Si el usuario prefiere no instalarlo, este script se puede saltear — el código de `pairItems` es testeable manualmente.

- [ ] **Step 3: Ejecutar y verificar**

Run: `pnpm tsx scripts/test-dedup.ts`
Expected: `6 pass, 0 fail`

- [ ] **Step 4: Borrar el script y commit**

```bash
rm scripts/test-dedup.ts
git add -A
git commit -m "chore: dedup smoke test verified (6/6 pass)"
```

> Nota: dejar el script vivo es una opción si el usuario lo quiere. Por defecto lo borro porque no hay test runner.

---

## Wave G — Pending batch helper

### Task G1: Crear `lib/telegram/pending-batch.ts`

**Files:**
- Create: `lib/telegram/pending-batch.ts`

- [ ] **Step 1: Crear el archivo**

```ts
// Helper para operaciones de batch sobre telegram_pending. Encapsula los
// CAST necesarios mientras `database.types.ts` no incluye las columnas
// nuevas en su totalidad (las agregamos en Task A2 pero algunos métodos
// agregados requieren cast por las foreign keys).

import { randomUUID } from "node:crypto";

import type { ExpenseItem } from "@/lib/ai/schemas";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface BatchInsertInput {
  userId: string;
  telegramChatId: number;
  telegramMessageId?: number | null;
  source: Database["public"]["Enums"]["tx_source"];
  walletId: string | null;
  items: Array<{
    item: ExpenseItem;
    categoryId: string | null;
    photoPath: string | null;
  }>;
}

export interface BatchPendingRow {
  id: string;
  batch_index: number;
  extraction: ExpenseItem;
  is_duplicate: boolean;
  transfer_hint: boolean;
  excluded: boolean;
  counterpart_wallet_id: string | null;
  duplicate_of_tx_id: string | null;
  suggested_wallet_id: string | null;
  suggested_category_id: string | null;
  photo_path: string | null;
  source: Database["public"]["Enums"]["tx_source"];
  user_id: string;
  telegram_chat_id: number;
  telegram_message_id: number | null;
}

export async function insertPendingBatch(
  supabase: AdminClient,
  input: BatchInsertInput,
): Promise<{ batchId: string; rowIds: string[] } | null> {
  const batchId = randomUUID();
  const rows = input.items.map((entry, index) => ({
    user_id: input.userId,
    telegram_chat_id: input.telegramChatId,
    telegram_message_id: input.telegramMessageId ?? null,
    extraction: entry.item as unknown as Database["public"]["Tables"]["telegram_pending"]["Insert"]["extraction"],
    photo_path: entry.photoPath,
    suggested_wallet_id: input.walletId,
    suggested_category_id: entry.categoryId,
    source: input.source,
    batch_id: batchId,
    batch_index: index,
    transfer_hint: entry.item.transfer_hint,
  }));

  const { data, error } = await supabase
    .from("telegram_pending")
    .insert(rows)
    .select("id");

  if (error || !data) {
    console.error("[telegram/pending-batch] insert failed", error);
    return null;
  }

  return { batchId, rowIds: data.map((r) => r.id) };
}

export async function attachMessageIdToBatch(
  supabase: AdminClient,
  batchId: string,
  telegramMessageId: number,
): Promise<void> {
  const { error } = await supabase
    .from("telegram_pending")
    .update({ telegram_message_id: telegramMessageId })
    .eq("batch_id", batchId);
  if (error) {
    console.error("[telegram/pending-batch] attach message_id failed", error);
  }
}

export async function setWalletForBatch(
  supabase: AdminClient,
  batchId: string,
  walletId: string,
): Promise<void> {
  const { error } = await supabase
    .from("telegram_pending")
    .update({ suggested_wallet_id: walletId })
    .eq("batch_id", batchId);
  if (error) {
    console.error("[telegram/pending-batch] set wallet failed", error);
    throw error;
  }
}

export async function applyDedupFlags(
  supabase: AdminClient,
  batchId: string,
  flags: Array<{ batch_index: number; is_duplicate: boolean; duplicate_of_tx_id: string | null }>,
): Promise<void> {
  // Could be done in parallel; sequential for simplicity and to surface errors clearly.
  for (const f of flags) {
    if (!f.is_duplicate) continue;
    const { error } = await supabase
      .from("telegram_pending")
      .update({
        is_duplicate: true,
        duplicate_of_tx_id: f.duplicate_of_tx_id,
      })
      .eq("batch_id", batchId)
      .eq("batch_index", f.batch_index);
    if (error) {
      console.error("[telegram/pending-batch] dedup flag failed", error);
    }
  }
}

export async function loadBatch(
  supabase: AdminClient,
  batchId: string,
  telegramChatId: number,
): Promise<BatchPendingRow[]> {
  const { data, error } = await supabase
    .from("telegram_pending")
    .select(
      "id, batch_index, extraction, is_duplicate, transfer_hint, excluded, counterpart_wallet_id, duplicate_of_tx_id, suggested_wallet_id, suggested_category_id, photo_path, source, user_id, telegram_chat_id, telegram_message_id",
    )
    .eq("batch_id", batchId)
    .eq("telegram_chat_id", telegramChatId)
    .order("batch_index", { ascending: true });

  if (error || !data) {
    console.error("[telegram/pending-batch] load failed", error);
    return [];
  }
  return data as unknown as BatchPendingRow[];
}

export async function excludeIndices(
  supabase: AdminClient,
  batchId: string,
  indices: number[],
): Promise<{ excluded: number[]; notFound: number[] }> {
  if (indices.length === 0) return { excluded: [], notFound: [] };

  const { data: rows } = await supabase
    .from("telegram_pending")
    .select("batch_index")
    .eq("batch_id", batchId);
  const existing = new Set((rows ?? []).map((r) => r.batch_index as number));
  const valid = indices.filter((i) => existing.has(i));
  const notFound = indices.filter((i) => !existing.has(i));

  if (valid.length > 0) {
    const { error } = await supabase
      .from("telegram_pending")
      .update({ excluded: true })
      .eq("batch_id", batchId)
      .in("batch_index", valid);
    if (error) {
      console.error("[telegram/pending-batch] exclude failed", error);
    }
  }

  return { excluded: valid, notFound };
}

export async function setCounterpart(
  supabase: AdminClient,
  pendingId: string,
  counterpartWalletId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("telegram_pending")
    .update({ counterpart_wallet_id: counterpartWalletId })
    .eq("id", pendingId);
  if (error) {
    console.error("[telegram/pending-batch] set counterpart failed", error);
  }
}

export async function deleteBatch(
  supabase: AdminClient,
  batchId: string,
): Promise<void> {
  const { error } = await supabase
    .from("telegram_pending")
    .delete()
    .eq("batch_id", batchId);
  if (error) {
    console.error("[telegram/pending-batch] delete failed", error);
  }
}
```

- [ ] **Step 2: Validar**

Run: `pnpm typecheck`
Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add lib/telegram/pending-batch.ts
git commit -m "feat(telegram): pending batch CRUD helpers"
```

---

## Wave H — Chat state helper

### Task H1: Crear `lib/telegram/chat-state.ts`

**Files:**
- Create: `lib/telegram/chat-state.ts`

- [ ] **Step 1: Crear el archivo**

```ts
// Mini-tabla key-value para "modo exclusión" y "modo transfer". Una fila
// por chat. Expira en 2 minutos por defecto.

import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

const TTL_MINUTES = 2;

export type ChatStateMode = "exclude" | "transfer";

export async function setAwaitingMode(
  supabase: AdminClient,
  chatId: number,
  mode: ChatStateMode,
  batchId: string,
): Promise<void> {
  const expires = new Date(Date.now() + TTL_MINUTES * 60 * 1000).toISOString();
  const payload =
    mode === "exclude"
      ? {
          telegram_chat_id: chatId,
          awaiting_exclude_batch_id: batchId,
          awaiting_transfer_batch_id: null,
          set_at: new Date().toISOString(),
          expires_at: expires,
        }
      : {
          telegram_chat_id: chatId,
          awaiting_exclude_batch_id: null,
          awaiting_transfer_batch_id: batchId,
          set_at: new Date().toISOString(),
          expires_at: expires,
        };

  const { error } = await supabase
    .from("telegram_chat_state")
    .upsert(payload, { onConflict: "telegram_chat_id" });
  if (error) {
    console.error("[telegram/chat-state] upsert failed", error);
  }
}

export async function getActiveAwaiting(
  supabase: AdminClient,
  chatId: number,
): Promise<{ mode: ChatStateMode; batchId: string } | null> {
  const { data, error } = await supabase
    .from("telegram_chat_state")
    .select("awaiting_exclude_batch_id, awaiting_transfer_batch_id, expires_at")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();
  if (error || !data) return null;

  if (new Date(data.expires_at).getTime() < Date.now()) {
    return null;
  }
  if (data.awaiting_exclude_batch_id) {
    return { mode: "exclude", batchId: data.awaiting_exclude_batch_id };
  }
  if (data.awaiting_transfer_batch_id) {
    return { mode: "transfer", batchId: data.awaiting_transfer_batch_id };
  }
  return null;
}

export async function clearAwaiting(
  supabase: AdminClient,
  chatId: number,
): Promise<void> {
  const { error } = await supabase
    .from("telegram_chat_state")
    .delete()
    .eq("telegram_chat_id", chatId);
  if (error) {
    console.error("[telegram/chat-state] clear failed", error);
  }
}
```

- [ ] **Step 2: Validar**

Run: `pnpm typecheck`
Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add lib/telegram/chat-state.ts
git commit -m "feat(telegram): chat state helper for exclude/transfer modes"
```

---

## Wave I — Preview render

### Task I1: Crear `lib/telegram/preview-batch.ts`

**Files:**
- Create: `lib/telegram/preview-batch.ts`

- [ ] **Step 1: Crear el archivo**

```ts
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
```

- [ ] **Step 2: Validar**

Run: `pnpm typecheck`
Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add lib/telegram/preview-batch.ts
git commit -m "feat(telegram): batch preview renderer with pagination"
```

---

## Wave J — Handler de callbacks de batch

### Task J1: Crear `lib/telegram/handlers/batch.ts` con esqueleto y wallet selector

**Files:**
- Create: `lib/telegram/handlers/batch.ts`

- [ ] **Step 1: Crear el archivo con el esqueleto y los handlers `bwallet:` y `bcanc:`**

```ts
// Callback handler para los prefijos `b*` (batch). Coexiste con el handler
// legacy (`confirm:`, `edit:`, `cancel:`) en `confirm.ts`.
//
// Prefijos:
//   bwallet:<batch_id>:<wallet_id>  → set wallet del batch + corre dedup + muestra preview
//   bconf:<batch_id>                → confirma items no excluidos y no dup
//   bconfall:<batch_id>             → confirma items no excluidos (incluye dups)
//   bexcl:<batch_id>                → entra a modo exclusión
//   bcanc:<batch_id>                → cancela batch entero
//   btrans:<batch_id>               → entra a modo marcado de transfers
//   btrset:<pending_id>:<wallet_id> → set counterpart para un item específico
//   btrdone:<batch_id>              → vuelve al preview principal

import type { Bot, Context } from "grammy";

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCategory } from "@/lib/telegram/category-resolver";
import { setAwaitingMode } from "@/lib/telegram/chat-state";
import { deduplicateBatch } from "@/lib/telegram/dedup";
import {
  applyDedupFlags,
  deleteBatch,
  loadBatch,
  setCounterpart,
  setWalletForBatch,
} from "@/lib/telegram/pending-batch";
import { buildBatchPreview, paginatePreview, type BatchPreviewItemInput } from "@/lib/telegram/preview-batch";

const ERROR_TEXT = "Algo falló";
const NOT_FOUND_TEXT = "El batch ya no está disponible";
const CANCELLED_TEXT = "❌ Batch cancelado";

const BATCH_CALLBACK_RE = /^(bwallet|bconf|bconfall|bexcl|bcanc|btrans|btrset|btrdone):/;

export function registerBatchHandler(bot: Bot): void {
  bot.on("callback_query:data", handleBatchCallback);
}

async function handleBatchCallback(ctx: Context, next: () => Promise<void>): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data || !BATCH_CALLBACK_RE.test(data)) {
    return next();
  }

  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    await ctx.answerCallbackQuery({ text: ERROR_TEXT });
    return;
  }

  const supabase = createAdminClient();
  const chat = ctx.chat;
  if (!chat) {
    await ctx.answerCallbackQuery();
    return;
  }

  // Dispatch by prefix.
  if (data.startsWith("bwallet:")) {
    await handleWalletPick(ctx, supabase, data);
  } else if (data.startsWith("bcanc:")) {
    await handleCancel(ctx, supabase, data);
  } else if (data.startsWith("bconfall:")) {
    await handleConfirm(ctx, supabase, data, true);
  } else if (data.startsWith("bconf:")) {
    await handleConfirm(ctx, supabase, data, false);
  } else if (data.startsWith("bexcl:")) {
    await handleEnterExclude(ctx, supabase, data);
  } else if (data.startsWith("btrans:")) {
    await handleEnterTransfer(ctx, supabase, data);
  } else if (data.startsWith("btrset:")) {
    await handleSetCounterpart(ctx, supabase, data);
  } else if (data.startsWith("btrdone:")) {
    await handleTransferDone(ctx, supabase, data);
  } else {
    await ctx.answerCallbackQuery();
  }
}

// =============================================================================
// bwallet — usuario eligió wallet en el selector
// =============================================================================
async function handleWalletPick(
  ctx: Context,
  supabase: ReturnType<typeof createAdminClient>,
  data: string,
): Promise<void> {
  const parts = data.split(":");
  if (parts.length !== 3) {
    await ctx.answerCallbackQuery({ text: ERROR_TEXT });
    return;
  }
  const [, batchId, walletId] = parts;
  const chatId = ctx.chat!.id;

  const rows = await loadBatch(supabase, batchId, chatId);
  if (rows.length === 0) {
    await ctx.answerCallbackQuery({ text: NOT_FOUND_TEXT });
    return;
  }

  await setWalletForBatch(supabase, batchId, walletId);

  const items = rows.map((r) => r.extraction);
  const dedup = await deduplicateBatch(supabase, rows[0].user_id, walletId, items, batchId);
  await applyDedupFlags(supabase, batchId, dedup);

  await renderBatchPreview(ctx, supabase, batchId, chatId);
  await ctx.answerCallbackQuery();
}

// =============================================================================
// bcanc — cancelar todo el batch
// =============================================================================
async function handleCancel(
  ctx: Context,
  supabase: ReturnType<typeof createAdminClient>,
  data: string,
): Promise<void> {
  const batchId = data.split(":")[1];
  await deleteBatch(supabase, batchId);
  await ctx.answerCallbackQuery({ text: "Cancelado" });
  try {
    await ctx.editMessageText(CANCELLED_TEXT);
  } catch (err) {
    console.error("[telegram/batch] edit failed", err);
  }
}

// =============================================================================
// Stubs — se implementan en J2/J3/K1/K2 para que el typecheck pase ya.
// =============================================================================
async function handleConfirm(
  ctx: Context,
  _supabase: ReturnType<typeof createAdminClient>,
  _data: string,
  _includeDuplicates: boolean,
): Promise<void> {
  await ctx.answerCallbackQuery({ text: "Próximamente" });
}

async function handleEnterExclude(
  ctx: Context,
  _supabase: ReturnType<typeof createAdminClient>,
  _data: string,
): Promise<void> {
  await ctx.answerCallbackQuery({ text: "Próximamente" });
}

async function handleEnterTransfer(
  ctx: Context,
  _supabase: ReturnType<typeof createAdminClient>,
  _data: string,
): Promise<void> {
  await ctx.answerCallbackQuery({ text: "Próximamente" });
}

async function handleSetCounterpart(
  ctx: Context,
  _supabase: ReturnType<typeof createAdminClient>,
  _data: string,
): Promise<void> {
  await ctx.answerCallbackQuery({ text: "Próximamente" });
}

async function handleTransferDone(
  ctx: Context,
  _supabase: ReturnType<typeof createAdminClient>,
  _data: string,
): Promise<void> {
  await ctx.answerCallbackQuery();
}

// =============================================================================
// Render del preview principal — se usa después de wallet pick, exclude, transfer
// =============================================================================
export async function renderBatchPreview(
  ctx: Context,
  supabase: ReturnType<typeof createAdminClient>,
  batchId: string,
  telegramChatId: number,
): Promise<number | null> {
  const rows = await loadBatch(supabase, batchId, telegramChatId);
  if (rows.length === 0) return null;

  const walletId = rows[0].suggested_wallet_id;
  if (!walletId) return null;

  const { data: wallet } = await supabase
    .from("wallets")
    .select("id, name, currency")
    .eq("id", walletId)
    .maybeSingle();
  if (!wallet) return null;

  const userId = rows[0].user_id;

  // Pre-fetch nombres de wallets contraparte
  const counterpartIds = rows
    .map((r) => r.counterpart_wallet_id)
    .filter((id): id is string => typeof id === "string");
  const counterpartNames = new Map<string, string>();
  if (counterpartIds.length > 0) {
    const { data: cw } = await supabase
      .from("wallets")
      .select("id, name")
      .in("id", counterpartIds);
    for (const w of cw ?? []) counterpartNames.set(w.id, w.name);
  }

  const previewItems: BatchPreviewItemInput[] = [];
  for (const row of rows) {
    const cat = await resolveCategory(
      supabase,
      userId,
      row.extraction.type === "income" ? "income" : "expense",
      row.extraction.category_hint,
      row.extraction.subcategory_hint,
    );
    previewItems.push({
      batch_index: row.batch_index,
      item: row.extraction,
      category_label: cat.label,
      is_duplicate: row.is_duplicate,
      duplicate_label: row.duplicate_of_tx_id ? "tx existente" : row.is_duplicate ? "pending" : null,
      transfer_hint: row.transfer_hint,
      counterpart_wallet_name: row.counterpart_wallet_id
        ? counterpartNames.get(row.counterpart_wallet_id) ?? null
        : null,
      excluded: row.excluded,
    });
  }

  const preview = buildBatchPreview({
    walletName: wallet.name,
    walletCurrency: wallet.currency,
    items: previewItems,
  });

  const pages = paginatePreview(preview.text);
  const keyboard = buildBatchKeyboard(batchId, rows.some((r) => r.transfer_hint && !r.counterpart_wallet_id));

  let lastMessageId: number | null = null;
  for (let i = 0; i < pages.length; i++) {
    const isLast = i === pages.length - 1;
    const msg = await ctx.reply(pages[i], {
      parse_mode: preview.markdown,
      reply_markup: isLast ? keyboard : undefined,
    });
    lastMessageId = msg.message_id;
  }

  return lastMessageId;
}

function buildBatchKeyboard(batchId: string, showTransferButton: boolean): {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
} {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  rows.push([{ text: "✅ Confirmar (excl dups)", callback_data: `bconf:${batchId}` }]);
  rows.push([{ text: "✅ Confirmar TODO", callback_data: `bconfall:${batchId}` }]);
  const actionsRow: Array<{ text: string; callback_data: string }> = [
    { text: "✏️ Excluir items", callback_data: `bexcl:${batchId}` },
  ];
  if (showTransferButton) {
    actionsRow.push({ text: "🔄 Marcar transfers", callback_data: `btrans:${batchId}` });
  }
  rows.push(actionsRow);
  rows.push([{ text: "❌ Cancelar", callback_data: `bcanc:${batchId}` }]);
  return { inline_keyboard: rows };
}
```

- [ ] **Step 2: Validar**

Run: `pnpm typecheck`
Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add lib/telegram/handlers/batch.ts
git commit -m "feat(telegram): batch callback handler skeleton + wallet pick"
```

### Task J2: Implementar `handleConfirm`

**Files:**
- Modify: `lib/telegram/handlers/batch.ts`

- [ ] **Step 1: Reemplazar el stub `handleConfirm` con la implementación**

Reemplazar el stub completo con:

```ts
async function handleConfirm(
  ctx: Context,
  supabase: ReturnType<typeof createAdminClient>,
  data: string,
  includeDuplicates: boolean,
): Promise<void> {
  const batchId = data.split(":")[1];
  const chatId = ctx.chat!.id;
  const rows = await loadBatch(supabase, batchId, chatId);
  if (rows.length === 0) {
    await ctx.answerCallbackQuery({ text: NOT_FOUND_TEXT });
    return;
  }

  const toPersist = rows.filter(
    (r) => !r.excluded && (includeDuplicates || !r.is_duplicate),
  );

  let persisted = 0;
  let failed = 0;

  // Persist transfers via RPC; expenses/incomes via direct insert.
  for (const row of toPersist) {
    if (row.counterpart_wallet_id && row.suggested_wallet_id) {
      const ok = await persistTransfer(supabase, row);
      if (ok) persisted++;
      else failed++;
    } else {
      const ok = await persistExpenseIncome(supabase, row);
      if (ok) persisted++;
      else failed++;
    }
  }

  await deleteBatch(supabase, batchId);

  const excludedCount = rows.filter((r) => r.excluded).length;
  const skippedDupCount = !includeDuplicates ? rows.filter((r) => r.is_duplicate && !r.excluded).length : 0;
  const failureNote = failed > 0 ? `\n   ⚠️ ${failed} fallaron` : "";

  try {
    await ctx.editMessageText(
      `✅ ${persisted} movimientos guardados\n   ❌ ${skippedDupCount} duplicados omitidos\n   ↩️ ${excludedCount} excluidos por vos${failureNote}`,
    );
  } catch (err) {
    console.error("[telegram/batch] edit after confirm failed", err);
  }
  await ctx.answerCallbackQuery({ text: "Listo" });
}

async function persistExpenseIncome(
  supabase: ReturnType<typeof createAdminClient>,
  row: import("@/lib/telegram/pending-batch").BatchPendingRow,
): Promise<boolean> {
  const ex = row.extraction;
  if (ex.type !== "expense" && ex.type !== "income") return false;
  if (!ex.amount || ex.amount <= 0) return false;
  if (!row.suggested_wallet_id) return false;

  const { data: wallet } = await supabase
    .from("wallets")
    .select("id, currency, archived")
    .eq("id", row.suggested_wallet_id)
    .maybeSingle();
  if (!wallet || wallet.archived) return false;

  const occurred = ex.occurred_at ? new Date(ex.occurred_at) : new Date();

  const { error } = await supabase.from("transactions").insert({
    user_id: row.user_id,
    wallet_id: wallet.id,
    category_id: row.suggested_category_id,
    type: ex.type,
    amount: ex.amount,
    currency: wallet.currency,
    occurred_at: occurred.toISOString(),
    description: ex.description ?? null,
    payee: ex.payee ?? null,
    photo_path: row.photo_path,
    source: row.source,
    source_metadata: { ai: ex, batch_id: row.id },
  });
  if (error) {
    console.error("[telegram/batch] tx insert failed", error);
    return false;
  }
  return true;
}

async function persistTransfer(
  supabase: ReturnType<typeof createAdminClient>,
  row: import("@/lib/telegram/pending-batch").BatchPendingRow,
): Promise<boolean> {
  const ex = row.extraction;
  if (!ex.amount || ex.amount <= 0) return false;
  if (!row.suggested_wallet_id || !row.counterpart_wallet_id) return false;

  // Direction depends on item.type:
  //  - expense → money leaves suggested_wallet, lands in counterpart
  //  - income  → money enters suggested_wallet, comes from counterpart
  const fromId = ex.type === "expense" ? row.suggested_wallet_id : row.counterpart_wallet_id;
  const toId = ex.type === "expense" ? row.counterpart_wallet_id : row.suggested_wallet_id;

  const { data: wallets } = await supabase
    .from("wallets")
    .select("id, currency, archived")
    .in("id", [fromId, toId]);
  const fromW = wallets?.find((w) => w.id === fromId);
  const toW = wallets?.find((w) => w.id === toId);
  if (!fromW || !toW || fromW.archived || toW.archived) return false;

  const sameCurrency = fromW.currency.toUpperCase() === toW.currency.toUpperCase();
  // For different currencies we'd need an FX rate. For v1 fall back to
  // expense/income split if currencies differ to avoid wrong rates.
  if (!sameCurrency) {
    return persistExpenseIncome(supabase, row);
  }

  const occurred = ex.occurred_at ? new Date(ex.occurred_at) : new Date();

  const { error } = await (
    supabase.rpc as unknown as (
      fn: "create_transfer",
      args: {
        p_user_id: string;
        p_from_wallet: string;
        p_to_wallet: string;
        p_amount_from: number;
        p_amount_to: number;
        p_currency_from: string;
        p_currency_to: string;
        p_fx_rate: number;
        p_occurred_at: string;
        p_note: string | null;
      },
    ) => Promise<{ data: string | null; error: { message?: string } | null }>
  )("create_transfer", {
    p_user_id: row.user_id,
    p_from_wallet: fromId,
    p_to_wallet: toId,
    p_amount_from: ex.amount,
    p_amount_to: ex.amount,
    p_currency_from: fromW.currency.toUpperCase(),
    p_currency_to: toW.currency.toUpperCase(),
    p_fx_rate: 1,
    p_occurred_at: occurred.toISOString(),
    p_note: ex.description ?? null,
  });

  if (error) {
    console.error("[telegram/batch] create_transfer RPC failed", error);
    return false;
  }
  return true;
}
```

- [ ] **Step 2: Validar**

Run: `pnpm typecheck`
Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add lib/telegram/handlers/batch.ts
git commit -m "feat(telegram): batch confirm with transfer support"
```

### Task J3: Implementar `handleEnterExclude` + reply parser

**Files:**
- Modify: `lib/telegram/handlers/batch.ts`
- Modify: `lib/telegram/handlers/text.ts` (en Wave L)

- [ ] **Step 1: Reemplazar el stub `handleEnterExclude`**

```ts
async function handleEnterExclude(
  ctx: Context,
  supabase: ReturnType<typeof createAdminClient>,
  data: string,
): Promise<void> {
  const batchId = data.split(":")[1];
  const chatId = ctx.chat!.id;
  await setAwaitingMode(supabase, chatId, "exclude", batchId);
  await ctx.reply(
    "Mandá los números a excluir separados por coma (ej: 3,7,12) o /cancel para volver. Tenés 2 minutos.",
  );
  await ctx.answerCallbackQuery();
}
```

- [ ] **Step 2: Validar**

Run: `pnpm typecheck`
Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add lib/telegram/handlers/batch.ts
git commit -m "feat(telegram): exclude mode entry"
```

---

## Wave K — Transfer marking

### Task K1: Implementar `handleEnterTransfer`, `handleSetCounterpart`, `handleTransferDone`

**Files:**
- Modify: `lib/telegram/handlers/batch.ts`

- [ ] **Step 1: Reemplazar los tres stubs**

```ts
async function handleEnterTransfer(
  ctx: Context,
  supabase: ReturnType<typeof createAdminClient>,
  data: string,
): Promise<void> {
  const batchId = data.split(":")[1];
  const chatId = ctx.chat!.id;
  const rows = await loadBatch(supabase, batchId, chatId);
  if (rows.length === 0) {
    await ctx.answerCallbackQuery({ text: NOT_FOUND_TEXT });
    return;
  }

  const targets = rows.filter((r) => r.transfer_hint && !r.excluded);
  if (targets.length === 0) {
    await ctx.answerCallbackQuery({ text: "No hay transfers para marcar" });
    return;
  }

  const userId = rows[0].user_id;
  const targetWalletId = rows[0].suggested_wallet_id;

  const { data: wallets } = await supabase
    .from("wallets")
    .select("id, name")
    .eq("user_id", userId)
    .eq("archived", false)
    .neq("id", targetWalletId ?? "")
    .order("position", { ascending: true });

  if (!wallets || wallets.length === 0) {
    await ctx.answerCallbackQuery({ text: "No tenés otra wallet" });
    return;
  }

  await setAwaitingMode(supabase, chatId, "transfer", batchId);
  await ctx.answerCallbackQuery();

  for (const row of targets) {
    const ex = row.extraction;
    const dateStr = ex.occurred_at ? new Date(ex.occurred_at).toLocaleDateString("es-AR") : "?";
    const summary = `${dateStr} · ${ex.amount ?? "?"} · ${ex.payee ?? ex.description ?? "—"}`;
    const buttons = wallets.map((w) => ({
      text: w.name,
      callback_data: `btrset:${row.id}:${w.id}`,
    }));
    // Chunk de a 2 por fila para no exceder
    const inline: Array<Array<{ text: string; callback_data: string }>> = [];
    for (let i = 0; i < buttons.length; i += 2) {
      inline.push(buttons.slice(i, i + 2));
    }
    await ctx.reply(`🔄 ${summary} → ¿a qué wallet?`, {
      reply_markup: { inline_keyboard: inline },
    });
  }

  await ctx.reply("Cuando termines, mandame /listo para volver al preview.", {
    reply_markup: {
      inline_keyboard: [[{ text: "← Volver al preview", callback_data: `btrdone:${batchId}` }]],
    },
  });
}

async function handleSetCounterpart(
  ctx: Context,
  supabase: ReturnType<typeof createAdminClient>,
  data: string,
): Promise<void> {
  const parts = data.split(":");
  if (parts.length !== 3) {
    await ctx.answerCallbackQuery({ text: ERROR_TEXT });
    return;
  }
  const [, pendingId, walletId] = parts;
  await setCounterpart(supabase, pendingId, walletId);
  await ctx.answerCallbackQuery({ text: "🔁 marcado" });
  try {
    await ctx.editMessageText(`🔁 transfer asignado a wallet`);
  } catch (err) {
    console.error("[telegram/batch] edit transfer-set failed", err);
  }
}

async function handleTransferDone(
  ctx: Context,
  supabase: ReturnType<typeof createAdminClient>,
  data: string,
): Promise<void> {
  const batchId = data.split(":")[1];
  const chatId = ctx.chat!.id;
  await renderBatchPreview(ctx, supabase, batchId, chatId);
  await ctx.answerCallbackQuery();
}
```

- [ ] **Step 2: Validar**

Run: `pnpm typecheck`
Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add lib/telegram/handlers/batch.ts
git commit -m "feat(telegram): transfer marking flow"
```

---

## Wave L — Handlers principales refactor

### Task L1: Refactor de `handlers/photo.ts` a flujo batch

**Files:**
- Modify: `lib/telegram/handlers/photo.ts` (completo)

- [ ] **Step 1: Reescribir el archivo completo**

```ts
// Photo handler — supporta batch flow.
//
// El usuario puede mandar:
//   - una foto de recibo (1 movimiento) → preview legacy (1-item batch).
//   - un screenshot de bank statement / billetera (N movimientos).
//
// Caption opcional: nombre de wallet (ej "nacion"). Si no resuelve, se
// muestra un selector de wallet inline. La dedup corre después de saber la
// wallet target.

import type { Bot, Context } from "grammy";

import { AiExtractionError, extractBatchFromImage } from "@/lib/ai/extract-expense";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCategory } from "@/lib/telegram/category-resolver";
import { deduplicateBatch } from "@/lib/telegram/dedup";
import { getLinkedUser } from "@/lib/telegram/get-linked-user";
import {
  applyDedupFlags,
  attachMessageIdToBatch,
  insertPendingBatch,
} from "@/lib/telegram/pending-batch";
import {
  fetchTelegramFile,
  uploadReceiptToStorage,
} from "@/lib/telegram/storage-helpers";
import { resolveWalletFromCaption } from "@/lib/telegram/wallet-resolver";

import { renderBatchPreview } from "./batch";

const ONBOARDING_TEXT = "Hola, primero vinculá la cuenta. /start.";
const MAINTENANCE_TEXT = "Servicio en mantenimiento";
const NO_WALLET_TEXT = "Primero creá una wallet en la app";
const NO_UNDERSTAND_TEXT = "No pude leer movimientos. Probá con otra foto.";
const GENERIC_ERROR = "Algo falló procesando la foto. Probá de nuevo.";

const MIN_CONFIDENCE = 0.4;

export function registerPhotoHandler(bot: Bot): void {
  bot.on("message:photo", handlePhoto);
}

async function handlePhoto(ctx: Context): Promise<void> {
  const from = ctx.from;
  const chat = ctx.chat;
  const message = ctx.message;
  if (!from || !chat || !message || !message.photo || message.photo.length === 0) {
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

  let batch;
  try {
    batch = await extractBatchFromImage(
      { data: bytes, mimeType: "image/jpeg" },
      linked.main_currency,
    );
  } catch (err) {
    if (err instanceof AiExtractionError) {
      console.error("[telegram/photo] AI extraction failed", err);
    } else {
      console.error("[telegram/photo] unexpected extractor error", err);
    }
    await ctx.reply(GENERIC_ERROR);
    return;
  }

  const validItems = batch.items.filter(
    (i) =>
      i.type !== "unknown" &&
      i.amount !== null &&
      i.amount > 0 &&
      i.confidence >= MIN_CONFIDENCE,
  );

  if (validItems.length === 0) {
    await ctx.reply(NO_UNDERSTAND_TEXT);
    return;
  }

  const supabase = createAdminClient();
  const walletRes = await resolveWalletFromCaption(
    supabase,
    linked.user_id,
    message.caption ?? null,
    linked.default_wallet_id,
  );
  if (walletRes.kind === "none") {
    await ctx.reply(NO_WALLET_TEXT);
    return;
  }

  // Pre-resolver categorías para cada item así guardamos `suggested_category_id`.
  const itemsForInsert = await Promise.all(
    validItems.map(async (item) => {
      const cat = await resolveCategory(
        supabase,
        linked.user_id,
        item.type === "income" ? "income" : "expense",
        item.category_hint,
        item.subcategory_hint,
      );
      return { item, categoryId: cat.id, photoPath };
    }),
  );

  const walletId =
    walletRes.kind === "resolved" ? walletRes.wallet.id : null;

  const inserted = await insertPendingBatch(supabase, {
    userId: linked.user_id,
    telegramChatId: chat.id,
    source: "telegram_photo",
    walletId,
    items: itemsForInsert,
  });

  if (!inserted) {
    await ctx.reply(GENERIC_ERROR);
    return;
  }

  if (walletRes.kind === "resolved") {
    const dedup = await deduplicateBatch(
      supabase,
      linked.user_id,
      walletRes.wallet.id,
      validItems,
      inserted.batchId,
    );
    await applyDedupFlags(supabase, inserted.batchId, dedup);
    const lastMessageId = await renderBatchPreview(ctx, supabase, inserted.batchId, chat.id);
    if (lastMessageId) {
      await attachMessageIdToBatch(supabase, inserted.batchId, lastMessageId);
    }
  } else {
    // Ask for wallet via selector.
    const keyboard = {
      inline_keyboard: walletRes.candidates.map((w) => [
        { text: w.name, callback_data: `bwallet:${inserted.batchId}:${w.id}` },
      ]),
    };
    const reply = await ctx.reply(
      `📋 Encontré ${validItems.length} ${validItems.length === 1 ? "movimiento" : "movimientos"}. ¿A qué wallet van?`,
      { reply_markup: keyboard },
    );
    await attachMessageIdToBatch(supabase, inserted.batchId, reply.message_id);
  }
}
```

- [ ] **Step 2: Borrar imports no usados del archivo viejo**

Verificar que no quedan imports legacy de `extractFromImage`, `buildConfirmKeyboard`, `insertPending`, `loadWallet`, `buildPreview`. Si quedan referencias colgadas, eliminarlas.

- [ ] **Step 3: Validar**

Run: `pnpm typecheck`
Expected: 0 errores.

Run: `pnpm lint lib/telegram/handlers/photo.ts`
Expected: 0 errores.

- [ ] **Step 4: Commit**

```bash
git add lib/telegram/handlers/photo.ts
git commit -m "refactor(telegram): photo handler uses batch flow"
```

### Task L2: Refactor de `handlers/text.ts` con interceptor de modos

**Files:**
- Modify: `lib/telegram/handlers/text.ts` (completo)

- [ ] **Step 1: Reescribir el archivo**

```ts
// Free-text handler con batch + interceptor de modo exclude/transfer.
//
// Flujo:
//   1. Si hay un "modo" activo en telegram_chat_state (exclude/transfer),
//      el mensaje se interpreta como input de ese modo y se NO corre AI.
//   2. Sino, fluye al extractor batch.
//
// "Modo exclusión": mensaje debe ser CSV de números o "/cancel".
// "Modo transfer": el usuario manda "/listo" para terminar; cualquier otro
//                  texto se ignora (los taps en inline keyboards no
//                  necesitan modo).

import { type Bot, type Context, type NextFunction } from "grammy";

import { AiExtractionError, extractBatchFromText } from "@/lib/ai/extract-expense";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCategory } from "@/lib/telegram/category-resolver";
import { clearAwaiting, getActiveAwaiting } from "@/lib/telegram/chat-state";
import { deduplicateBatch } from "@/lib/telegram/dedup";
import { getLinkedUser } from "@/lib/telegram/get-linked-user";
import {
  applyDedupFlags,
  attachMessageIdToBatch,
  excludeIndices,
  insertPendingBatch,
} from "@/lib/telegram/pending-batch";
import { resolveWalletFromCaption } from "@/lib/telegram/wallet-resolver";

import { renderBatchPreview } from "./batch";

const ONBOARDING_TEXT = "Hola, primero vinculá la cuenta. /start.";
const MAINTENANCE_TEXT = "Servicio en mantenimiento";
const NO_WALLET_TEXT = "Primero creá una wallet en la app";
const NO_UNDERSTAND_TEXT = "No entendí. Probá: 'gasté 200 en almuerzo'";
const GENERIC_ERROR = "Algo falló procesando tu mensaje. Probá de nuevo.";

const MIN_CONFIDENCE = 0.4;

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
  if (!supabaseConfigured) {
    if (commandEntities.length === 0) {
      await ctx.reply(MAINTENANCE_TEXT);
    }
    return next();
  }

  const supabase = createAdminClient();

  // --- Mode interception (exclude / transfer) ---
  const awaiting = await getActiveAwaiting(supabase, chat.id);
  if (awaiting) {
    const text = message.text.trim();
    if (text === "/cancel" || text === "/listo") {
      await clearAwaiting(supabase, chat.id);
      await ctx.reply("Listo, volvé a tapear botones del preview.");
      return;
    }
    if (awaiting.mode === "exclude") {
      const parsed = text.match(/^[\d,\s]+$/)
        ? text
            .split(",")
            .map((s) => Number.parseInt(s.trim(), 10))
            .filter((n) => Number.isInteger(n) && n > 0)
            .map((n) => n - 1) // user uses 1-indexed in preview
        : null;
      if (!parsed || parsed.length === 0) {
        await ctx.reply("No entendí. Mandá ej: 3,7,12 o /cancel.");
        return;
      }
      const result = await excludeIndices(supabase, awaiting.batchId, parsed);
      await clearAwaiting(supabase, chat.id);

      const excludedHuman = result.excluded.map((i) => i + 1).join(",");
      const notFoundHuman = result.notFound.map((i) => i + 1).join(",");
      const lines: string[] = [];
      if (excludedHuman) lines.push(`✏️ Excluí: ${excludedHuman}.`);
      if (notFoundHuman) lines.push(`No existen: ${notFoundHuman}.`);
      await ctx.reply(lines.join(" "));
      await renderBatchPreview(ctx, supabase, awaiting.batchId, chat.id);
      return;
    }
    // mode === 'transfer': free text not interpreted; user uses inline kbd.
    await ctx.reply("Tapeá los botones para asignar wallet contraparte, o mandame /listo.");
    return;
  }

  // --- Comandos pasan al chain ---
  if (commandEntities.length > 0) {
    return next();
  }

  const linked = await getLinkedUser(from.id);
  if (!linked) {
    await ctx.reply(ONBOARDING_TEXT);
    return;
  }

  let batch;
  try {
    batch = await extractBatchFromText(message.text, linked.main_currency);
  } catch (err) {
    if (err instanceof AiExtractionError) {
      console.error("[telegram/text] AI extraction failed", err);
    } else {
      console.error("[telegram/text] unexpected extractor error", err);
    }
    await ctx.reply(GENERIC_ERROR);
    return;
  }

  const validItems = batch.items.filter(
    (i) =>
      i.type !== "unknown" &&
      i.amount !== null &&
      i.amount > 0 &&
      i.confidence >= MIN_CONFIDENCE,
  );
  if (validItems.length === 0) {
    await ctx.reply(NO_UNDERSTAND_TEXT);
    return;
  }

  const walletRes = await resolveWalletFromCaption(
    supabase,
    linked.user_id,
    null,
    linked.default_wallet_id,
  );
  if (walletRes.kind === "none") {
    await ctx.reply(NO_WALLET_TEXT);
    return;
  }

  const itemsForInsert = await Promise.all(
    validItems.map(async (item) => {
      const cat = await resolveCategory(
        supabase,
        linked.user_id,
        item.type === "income" ? "income" : "expense",
        item.category_hint,
        item.subcategory_hint,
      );
      return { item, categoryId: cat.id, photoPath: null };
    }),
  );

  const walletId = walletRes.kind === "resolved" ? walletRes.wallet.id : null;

  const inserted = await insertPendingBatch(supabase, {
    userId: linked.user_id,
    telegramChatId: chat.id,
    source: "telegram_text",
    walletId,
    items: itemsForInsert,
  });
  if (!inserted) {
    await ctx.reply(GENERIC_ERROR);
    return;
  }

  if (walletRes.kind === "resolved") {
    const dedup = await deduplicateBatch(
      supabase,
      linked.user_id,
      walletRes.wallet.id,
      validItems,
      inserted.batchId,
    );
    await applyDedupFlags(supabase, inserted.batchId, dedup);
    const lastMessageId = await renderBatchPreview(ctx, supabase, inserted.batchId, chat.id);
    if (lastMessageId) {
      await attachMessageIdToBatch(supabase, inserted.batchId, lastMessageId);
    }
  } else {
    const keyboard = {
      inline_keyboard: walletRes.candidates.map((w) => [
        { text: w.name, callback_data: `bwallet:${inserted.batchId}:${w.id}` },
      ]),
    };
    const reply = await ctx.reply(
      `📋 Encontré ${validItems.length} ${validItems.length === 1 ? "movimiento" : "movimientos"}. ¿A qué wallet van?`,
      { reply_markup: keyboard },
    );
    await attachMessageIdToBatch(supabase, inserted.batchId, reply.message_id);
  }
}
```

- [ ] **Step 2: Validar**

Run: `pnpm typecheck`
Expected: 0 errores.

Run: `pnpm lint lib/telegram/handlers/text.ts`
Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add lib/telegram/handlers/text.ts
git commit -m "refactor(telegram): text handler uses batch flow + mode interception"
```

### Task L3: Refactor de `handlers/voice.ts` a flujo batch

**Files:**
- Modify: `lib/telegram/handlers/voice.ts` (completo)

- [ ] **Step 1: Leer el archivo actual y adaptarlo**

Cambiar la llamada a `extractFromAudio` por `extractBatchFromAudio`, y todo el flujo de pending single (insertPending + buildPreview + buildConfirmKeyboard) por el equivalente batch (insertPendingBatch + renderBatchPreview), como hicimos en photo.ts y text.ts.

> Si el archivo es corto y simétrico al photo handler, copiarlo y adaptarlo (cambiar `extractBatchFromImage` por `extractBatchFromAudio`, no hay caption en audios, photoPath siempre null, source `telegram_audio`).

- [ ] **Step 2: Validar**

Run: `pnpm typecheck`
Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add lib/telegram/handlers/voice.ts
git commit -m "refactor(telegram): voice handler uses batch flow"
```

---

## Wave M — Registrar handler y verificación E2E

### Task M1: Wire-up del nuevo handler de batch

**Files:**
- Modify: `lib/telegram/handlers/index.ts:43-66` (función `registerHandlers`)

- [ ] **Step 1: Importar y registrar el nuevo handler**

Agregar el import al top:

```ts
import { registerBatchHandler } from "./batch";
```

Y modificar el cuerpo de `registerHandlers` para que quede así:

```ts
export function registerHandlers(bot: Bot): void {
  // --- Wave 3 ---
  registerStartHandler(bot);
  registerStatusHandlers(bot);

  // --- Wave 4C splice point ---
  // Order:
  //   - batch FIRST so b* callbacks no caen al confirm legacy (que matchea
  //     confirm/edit/cancel: prefixes only) y se interceptan correctamente.
  //   - confirm SECOND for legacy single-item flows still in flight.
  //   - photo / voice BEFORE text para media handlers.
  //   - text LAST entre handlers nuevos — intercepta /cancel y CSV de exclusión.
  registerBatchHandler(bot);
  registerConfirmHandler(bot);
  registerPhotoHandler(bot);
  registerVoiceHandler(bot);
  registerTextHandler(bot);

  // --- Catch-all (KEEP LAST) ---
  registerCatchAll(bot);
}
```

- [ ] **Step 2: Validar**

Run: `pnpm typecheck && pnpm lint`
Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add lib/telegram/handlers/index.ts
git commit -m "feat(telegram): register batch handler before legacy confirm"
```

### Task M2: Smoke test E2E manual

**Files:**
- (no edits)

- [ ] **Step 1: Levantar dev server**

Run: `pnpm dev`
Expected: Next.js arranca, webhook listo en `/api/telegram/webhook`.

> Si el webhook no está apuntando al dev local, usar `ngrok` o el panel de Telegram para set el webhook URL contra el túnel. Es la misma config que usaron en waves anteriores.

- [ ] **Step 2: Test caso A — single-item text (regression check)**

Desde Telegram, mandar al bot: `gasté 200 en café`
Expected:
- Preview con 1 movimiento, icono ✨.
- Botones: Confirmar (excl dups), Confirmar TODO, Excluir items, Cancelar.
- Tapear "Confirmar (excl dups)" → "✅ 1 movimiento guardado".
- Verificar en `pnpm dev` (web app) que la tx aparece en /transactions.

- [ ] **Step 3: Test caso B — multi-item text**

Mandar: `gasté 200 en café y 1500 en uber, y cobré 80000 de freelance`
Expected:
- Preview con 3 movimientos numerados, todos ✨.
- Resumen: "3 nuevos · 0 duplicados".
- Tapear "Confirmar" → "✅ 3 movimientos guardados".

- [ ] **Step 4: Test caso C — dedup**

Volver a mandar el mismo texto del paso anterior.
Expected:
- Preview con 3 movimientos, todos ⚠️ duplicado.
- Resumen: "0 nuevos · 3 duplicados".
- Tapear "Confirmar (excl dups)" → "✅ 0 movimientos guardados · ❌ 3 duplicados omitidos".

- [ ] **Step 5: Test caso D — screenshot bank statement**

Adjuntar el screenshot del Banco Nación (el primer image que el usuario mandó originalmente) con caption "nacion".
Expected:
- Preview con ~24 items numerados, mezcla de ✨ / 🔄 (DEBIN, PERCEPCION, TRANSFERENCIA PUSH).
- Botón "🔄 Marcar transfers" visible.
- Verificar que payees como "Makro", "PedidosYa", "Edenor", "SUBE" están correctamente normalizados.

- [ ] **Step 6: Test caso E — exclusión**

Sobre el batch del paso anterior, tapear "Excluir items", responder con `3,7,12`.
Expected:
- Bot responde "Excluí: 3,7,12."
- Preview se re-renderiza con esos items mostrando icono ⏭️.

- [ ] **Step 7: Test caso F — selector de wallet**

Mandar un screenshot sin caption (o con caption inválido tipo "asdf").
Expected:
- Bot pregunta "¿A qué wallet van?" con botones de cada wallet activa.
- Tapear una → corre dedup y muestra preview normal.

- [ ] **Step 8: Test caso G — marcar transfer**

Sobre un batch con items 🔄, tapear "Marcar transfers".
Expected:
- Bot manda un mensaje por cada item de transfer con buttons de wallet contraparte.
- Tapear uno → icono cambia a 🔁 y nombre de wallet en el mensaje.
- Tapear "Volver al preview" → preview principal con items 🔁 mostrando "→ <wallet>".
- Confirmar → los items 🔁 se crean como transfers (verificar en /transfers en la web app), el resto como expense/income.

- [ ] **Step 9: Commit (sin cambios; este step es solo doc)**

> No hay cambios para commitear. Si se detectaron bugs en cualquier sub-paso, volver al wave correspondiente y arreglar.

---

## Self-Review

**1. Spec coverage:**
- §5.1 migración → Task A1 ✓
- §5.2 schema Zod → Task B1 ✓
- §6 extractor → Tasks C1, C2 ✓
- §7 wallet resolver → Task E1 ✓
- §8 dedup → Tasks F1, F2 ✓
- §9.1 preview rendering → Task I1 ✓
- §9.2 inline keyboard → Task J1 (`buildBatchKeyboard`) ✓
- §9.3 exclude flow → Tasks J3 + L2 ✓
- §9.4 transfer marking → Task K1 ✓
- §9.5 confirm atómico → Task J2 ✓
- §10 errores → cubiertos a lo largo de tasks J/L vía guards
- §11 seguridad → `loadBatch` filtra por `telegram_chat_id` ✓
- §12 observability → logs en console.error; estructurado se puede mejorar post-v1
- §13 cleanup cron → fuera de scope de este plan (existing cron toca; modificarlo es 1 tarea extra que se puede agregar después si necesario)

**2. Placeholder scan:** sin TBD/TODO. Todos los stubs en J1 se reemplazan en tareas posteriores.

**3. Type consistency:** `BatchPreviewItemInput`, `BatchPendingRow`, `WalletResolution`, `DedupResult` consistentes entre archivos. `ExpenseItem` reemplaza a `ExpenseExtraction` con alias mantenido por compat. Funciones `applyDedupFlags`, `attachMessageIdToBatch`, `setWalletForBatch`, `excludeIndices`, `setCounterpart`, `deleteBatch`, `loadBatch`, `insertPendingBatch` aparecen con la misma firma en `pending-batch.ts` y en los consumers. `renderBatchPreview` exporta de `handlers/batch.ts` y se usa desde `handlers/photo.ts`, `text.ts`, `voice.ts` con la misma firma `(ctx, supabase, batchId, chatId) → number | null`.
