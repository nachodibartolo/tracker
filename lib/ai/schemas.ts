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
