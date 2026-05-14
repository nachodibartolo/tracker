import { generateObject } from "ai";

import { geminiFlash, requireGoogleAi } from "./provider";
import {
  CATEGORY_HINTS,
  ExpenseExtractionSchema,
  type ExpenseExtraction,
} from "./schemas";

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
    "El campo 'amount' debe ser positivo aunque sea un gasto. El signo lo determina 'type'.",
    `Los slugs válidos para 'category_hint' son exactamente: ${CATEGORY_LIST}. Usá null si ninguno aplica.`,
    "Si la fecha no aparece explícita, devolvé 'occurred_at' = null (el sistema usará 'ahora').",
    "'confidence' debe reflejar honestamente qué tan segura está la extracción (0 = adivinanza, 1 = totalmente claro).",
    "Si el input no parece un gasto/ingreso o no se puede interpretar, devolvé type='unknown' y los campos que no sepas en null.",
  ].join(" ");
}

/**
 * Extract structured expense data from a free-text message (Telegram, web
 * form, etc.). Rioplatense Spanish prompt.
 */
export async function extractFromText(
  text: string,
  defaultCurrency: string,
): Promise<ExpenseExtraction> {
  requireGoogleAi();

  const system = [
    "Sos un extractor de gastos personales para un argentino. Recibís texto libre en español rioplatense (ej: '150 cafe en Starbucks', 'pagué 12.500 de luz a Edesur', 'me entraron 800 USD de freelance').",
    "Tu tarea es identificar si es un gasto, un ingreso o algo desconocido, y completar todos los campos del schema con la mejor inferencia posible.",
    "Ejemplos:",
    "- '150 cafe en Starbucks' => {type:'expense', amount:150, currency:default, payee:'Starbucks', description:'cafe', category_hint:'comida', occurred_at:null, confidence:0.85}",
    "- 'pagué 12.500 de luz a Edesur' => {type:'expense', amount:12500, currency:default, payee:'Edesur', description:'luz', category_hint:'servicios', occurred_at:null, confidence:0.9}",
    "- 'me entraron 800 USD de freelance' => {type:'income', amount:800, currency:'USD', payee:null, description:'freelance', category_hint:'freelance', occurred_at:null, confidence:0.85}",
    baseSchemaInstructions(defaultCurrency),
  ].join("\n");

  try {
    const { object } = await generateObject({
      model: geminiFlash,
      schema: ExpenseExtractionSchema,
      system,
      prompt: text,
      temperature: 0.2,
    });
    return object;
  } catch (err) {
    throw new AiExtractionError(
      "text",
      err instanceof Error ? err.message : "Failed to extract expense from text",
      { cause: err },
    );
  }
}

/**
 * Extract structured expense data from a photo of a ticket/receipt.
 */
export async function extractFromImage(
  image: BinaryInput,
  defaultCurrency: string,
): Promise<ExpenseExtraction> {
  requireGoogleAi();

  const system = [
    "Recibís fotos de tickets/recibos en español. Extraé el total final pagado (no subtotales), el comercio, la fecha si está visible. Si el total tiene IVA incluido tomalo. Si no se ve un total claro, devolvé type='unknown'.",
    baseSchemaInstructions(defaultCurrency),
  ].join("\n");

  try {
    const { object } = await generateObject({
      model: geminiFlash,
      schema: ExpenseExtractionSchema,
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
      err instanceof Error ? err.message : "Failed to extract expense from image",
      { cause: err },
    );
  }
}

/**
 * Extract structured expense data from a short voice note (Telegram audio).
 */
export async function extractFromAudio(
  audio: BinaryInput,
  defaultCurrency: string,
): Promise<ExpenseExtraction> {
  requireGoogleAi();

  const system = [
    "Recibís audios cortos en español rioplatense narrando un gasto. Transcribí mentalmente y extraé los datos.",
    baseSchemaInstructions(defaultCurrency),
  ].join("\n");

  try {
    const { object } = await generateObject({
      model: geminiFlash,
      schema: ExpenseExtractionSchema,
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
      temperature: 0.2,
    });
    return object;
  } catch (err) {
    throw new AiExtractionError(
      "audio",
      err instanceof Error ? err.message : "Failed to extract expense from audio",
      { cause: err },
    );
  }
}
