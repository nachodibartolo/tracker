import { generateObject } from "ai";

import { geminiFlash, requireGoogleAi } from "./provider";
import {
  CATEGORY_HINTS,
  ExpenseBatchExtractionSchema,
  type ExpenseBatchExtraction,
  type ExpenseItem,
  type ExpenseExtraction,
} from "./schemas";

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

/**
 * Typed error surfaced by every extractor. The cause (the original SDK /
 * network / validation error) is preserved for logging.
 */
export class AiExtractionError extends Error {
  readonly source: "text" | "image" | "audio";

  constructor(source: "text" | "image" | "audio", message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AiExtractionError";
    this.source = source;
  }
}

type BinaryInput = {
  /** Binary payload as a Uint8Array, Buffer, or ArrayBuffer. */
  data: Uint8Array | Buffer | ArrayBuffer;
  /** IANA media type, e.g. "image/jpeg", "audio/ogg". */
  mimeType: string;
};

const CATEGORY_LIST = CATEGORY_HINTS.join(" | ");

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
    "transfer_hint: marcalo true SOLO si el concepto contiene alguno de estos patrones (matching case-insensitive, accent-insensitive); en cualquier otro caso, marcalo false:",
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

/**
 * Wrapper thin: delega en `extractBatchFromImage` y devuelve el primer item.
 */
export async function extractFromImage(
  image: BinaryInput,
  defaultCurrency: string,
): Promise<ExpenseExtraction> {
  const batch = await extractBatchFromImage(image, defaultCurrency);
  return batch.items[0] ?? UNKNOWN_ITEM;
}

/**
 * Wrapper thin: delega en `extractBatchFromAudio` y devuelve el primer item.
 */
export async function extractFromAudio(
  audio: BinaryInput,
  defaultCurrency: string,
): Promise<ExpenseExtraction> {
  const batch = await extractBatchFromAudio(audio, defaultCurrency);
  return batch.items[0] ?? UNKNOWN_ITEM;
}

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
