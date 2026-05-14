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
 * Structured output produced by the AI extractor from text, image or audio
 * input. All "unknown" fields must be `null` (never empty strings) so the
 * caller can clearly differentiate "model could not infer this" from a real
 * empty value.
 */
export const ExpenseExtractionSchema = z.object({
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
    .describe("Resumen corto del gasto/ingreso. Máx 200 chars."),
  category_hint: z
    .enum(CATEGORY_HINTS)
    .nullable()
    .describe(
      "Slug de categoría sugerida. Debe ser uno de la lista canónica o null.",
    ),
  occurred_at: z
    .string()
    .datetime({ offset: true })
    .nullable()
    .describe(
      "Fecha y hora ISO 8601 cuando ocurrió. null = usar 'ahora' al persistir.",
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Confianza de la extracción, entre 0 y 1."),
});

export type ExpenseExtraction = z.infer<typeof ExpenseExtractionSchema>;
