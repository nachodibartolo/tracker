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
  /** Optional UUID of the wallet to use when the user does not specify one. */
  defaultWalletId?: string;
}

export interface DateContext {
  todayIso: string;
  todayYearAr: string;
}

export function currentDateContext(): DateContext {
  const now = new Date();
  const yearAr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  })
    .format(now)
    .slice(0, 4);
  return {
    todayIso: now.toISOString(),
    todayYearAr: yearAr,
  };
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
