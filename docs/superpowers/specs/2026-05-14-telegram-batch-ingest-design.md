# Telegram Batch Ingest — Diseño

**Fecha:** 2026-05-14
**Autor:** Nacho (con Claude)
**Estado:** Aprobado, listo para plan de implementación

---

## 1. Motivación

Hoy el bot de Telegram acepta un movimiento por mensaje (texto, foto de recibo, o audio). El uso real requiere cargar de a tandas: screenshots de homebanking (Nación), de billeteras virtuales (Mercado Pago, Ualá, Modo), y a veces texto libre con varios items en una frase. Cargar 24 movimientos a mano disuade el uso del tracker.

Además, al importar tandas hay riesgo de duplicar: el mismo movimiento puede aparecer en un screenshot que ya se cargó, o el usuario re-importa por error. Sin dedup, la app se contamina rápido.

## 2. Objetivos

- Aceptar **varios movimientos por mensaje** desde cuatro fuentes: bank statement, feed de billetera virtual, texto libre multi-item, y series de fotos scrolleadas del mismo statement.
- **Detectar duplicados** automáticamente contra transacciones ya cargadas y contra pendings de batches anteriores, con override manual.
- **Preservar el flujo single-item actual**: un mensaje con un solo movimiento sigue funcionando idéntico (las funciones `extractFromText/Image/Audio` quedan como wrappers thin).
- **Soportar subcategorías** (modelo de 2 niveles vía `parent_id` introducido en migración 0009).
- **Marcar transferencias internas** entre wallets del usuario sin requerir matching cross-screenshot — el AI sugiere con hints estáticos en el prompt y el usuario decide la contraparte.

## 3. No-objetivos (v1)

- Conversations grammY con state machine compleja (usamos una tabla mini `telegram_chat_state`).
- Auto-match cross-screenshot de transfers (ej: matchear un débito del Nación con un crédito en MP por monto+fecha).
- Edición de campos individuales por item dentro del preview (el usuario edita en la web app después de confirmar).
- Inferencia de wallet target por contenido del screenshot (logos, encabezados); usamos caption del mensaje o selector.

## 4. Arquitectura

Tres capas se modifican; el resto del bot queda intacto:

```
Telegram update
   │
   ▼
[handlers/*.ts]  ──► extractBatchFrom{Text,Image,Audio}  (lib/ai/extract-expense.ts)
   │                       │
   │                       ▼
   │                ExpenseBatchExtractionSchema
   │                       │
   ▼                       ▼
[resolveWalletFromCaption]   ──► (si falla)  selector inline de wallets
   │
   ▼
[deduplicateBatch] ──► transactions ∪ telegram_pending  (1 query, pairing 1:1)
   │
   ▼
[insertPendingBatch] ──► N filas en telegram_pending (mismo batch_id)
   │
   ▼
[buildBatchPreview] ──► mensaje MarkdownV2 + inline keyboard
   │
   ▼
Usuario interactúa: confirmar / excluir / marcar transfer / cancelar
   │
   ▼
[handleBatchCallback] ──► UPDATE filas pending  ó  INSERT transactions atómico
```

## 5. Cambios al schema de datos

### 5.1 Migración `0010_telegram_pending_batch.sql`

```sql
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

**Semántica**:
- Single-item input → 1 fila con `batch_id = gen_random_uuid()`, `batch_index = 0`.
- Batch de N items → N filas con el mismo `batch_id`, `batch_index = 0..N-1`.
- `duplicate_of_tx_id` apunta a la tx existente que matchea (para mostrar contexto en el preview).
- `counterpart_wallet_id` se setea cuando el usuario marca un item como transfer interno.
- `telegram_message_id` se llena cuando el bot manda el preview, para correlacionar callbacks.

### 5.2 Schema Zod (`lib/ai/schemas.ts`)

Renombramos el actual `ExpenseExtractionSchema` → `ExpenseItemSchema` y agregamos tres campos:

```ts
export const ExpenseItemSchema = z.object({
  // ...campos actuales: type, amount, currency, payee, description,
  //    category_hint, occurred_at, confidence...
  subcategory_hint: z.string().max(40).nullable()
    .describe("Texto libre, una sola palabra/frase en minúsculas (ej: 'café', 'supermercado', 'comida rápida'). null si no se puede afinar más allá del top-level."),
  transfer_hint: z.boolean()
    .describe("true si el concepto sugiere una transferencia interna entre wallets propias (DEBIN, TRANSFERENCIA PUSH, INGRESO DE DINERO, CREDITO INMEDIATO, etc.)."),
  external_id: z.string().max(120).nullable()
    .describe("ID de operación si la fuente lo muestra (ej: número de comprobante MP). null si no aparece."),
});

export type ExpenseItem = z.infer<typeof ExpenseItemSchema>;

export const SourceKindSchema = z.enum([
  'receipt',           // foto de ticket/recibo, 1 item
  'bank_statement',    // tabla homebanking (Nación, etc.)
  'wallet_app_feed',   // feed estilo MP, Modo, Ualá
  'free_text',         // texto libre con varios items
  'unknown',
]);

export const ExpenseBatchExtractionSchema = z.object({
  source_kind: SourceKindSchema,
  items: z.array(ExpenseItemSchema).max(100),
});

export type ExpenseBatchExtraction = z.infer<typeof ExpenseBatchExtractionSchema>;
```

**Backwards compat**: `ExpenseExtraction` se mantiene como alias de `ExpenseItem` para que código viejo siga compilando.

## 6. AI extractor

### 6.1 Funciones nuevas (`lib/ai/extract-expense.ts`)

```ts
extractBatchFromText(text, defaultCurrency, opts?): Promise<ExpenseBatchExtraction>
extractBatchFromImage(image, defaultCurrency, opts?): Promise<ExpenseBatchExtraction>
extractBatchFromAudio(audio, defaultCurrency): Promise<ExpenseBatchExtraction>
```

Las funciones single (`extractFromText/Image/Audio`) se convierten en wrappers thin:

```ts
export async function extractFromText(text, defaultCurrency) {
  const batch = await extractBatchFromText(text, defaultCurrency);
  return batch.items[0] ?? buildUnknownExpense();
}
```

### 6.2 System prompt — capas

**Capa 1 — Detección de `source_kind`**:
> Identificá si el input es: (a) un recibo/ticket con UN total (`receipt`); (b) una tabla de homebanking con múltiples filas Fecha/Concepto/Débitos/Créditos (`bank_statement`); (c) un feed de billetera virtual estilo Mercado Pago/Modo/Ualá con avatares y montos por día (`wallet_app_feed`); (d) texto libre describiendo uno o más gastos (`free_text`); (e) nada de lo anterior (`unknown`, `items=[]`).

**Capa 2 — Hints de transferencia interna** (inline en el prompt):
- Bank statement: `DEBIN`, `TRANSFERENCIA PUSH`, `CREDITO INMEDIATO`, `DEB PREA`, `PAGO PERSONAL <CBU>`, `TRANSFERENCIA RECIBIDA`, `TRANSFERENCIA ENVIADA`
- Wallet apps: `Ingreso de dinero` (con cualquier subtítulo), `Transferencia recibida`, `Transferencia enviada`
- Regla: marcar `transfer_hint=true` SOLO basándote en el texto del concepto. El bot decide la contraparte después.

**Capa 3 — Normalización de payees argentinos** (inline en el prompt, ~30 entries):
```
CPA. PEDIDOSYA *   → payee="PedidosYa", category="comida", subcategory="comida rápida"
CPA. MAKRO *       → payee="Makro", category="comida", subcategory="supermercado"
CPA. COTO *        → payee="Coto", category="comida", subcategory="supermercado"
CPA. CARREFOUR *   → payee="Carrefour", category="comida", subcategory="supermercado"
CPA. DISCO *       → payee="Disco", category="comida", subcategory="supermercado"
CPA. EDENOR* / EDESUR* → payee="<empresa>", category="servicios"
CPA. TELECOM* / MOVISTAR* / PERSONAL* / CLARO* → payee="<empresa>", category="servicios"
CPA. METROGAS* / NATURGY*    → payee="<empresa>", category="servicios"
CPA. AYSA*                   → payee="AySA", category="servicios"
CPA. APPLE.COM/BILL / SPOTIFY* / NETFLIX* / DISNEY* / HBO* → payee="<empresa>", category="entretenimiento"
CPA. UBER* / CABIFY*         → payee="<empresa>", category="transporte"
CPA. SUBE*                   → payee="SUBE", category="transporte"
CPA. CLUB LA NACION          → payee="Club La Nación", category="entretenimiento"
CPA. ABL *                   → payee="ABL (rentas CABA)", category="hogar"
CPA. EDUCATION / BOOT.DEV / UDEMY*  → category="educacion"
IVA SERV DIG EXT             → payee="AFIP - IVA", category="otros"
PERCEPCION TD RG 4815/20     → payee="AFIP - percepción", category="otros"
PERCEPCION IIBB              → payee="IIBB - percepción", category="otros"
```

Regla general: si no matchea ningún pattern conocido, limpiar prefijos (`CPA. `, `DEB `, sufijos como ` R`, números crudos) y dejar el resto como payee. La descripción siempre conserva el concepto crudo.

**Capa 4 — Reglas anti-alucinación**:
- Si una fila no tiene débito ni crédito visibles, no la inventes.
- Si el screenshot está cortado y la última fila parece incompleta, omitila.
- No infieras más items de los que ves.
- Para fechas DD/MM/AA, el año "26" → 2026. Si la fecha resulta a futuro del current date (le pasamos `currentDate` en el system prompt), asumir año anterior.
- Sin hora visible → output ISO con `T12:00:00` en hora local (`America/Argentina/Buenos_Aires`).

### 6.3 Configuración del modelo

- `temperature: 0` (más estricto que `0.2` actual; queremos determinismo para statements).
- `maxItems: 100` en el schema previene loops.
- Si el modelo timeoutea con un batch grande, el caller no reintenta automáticamente; loguea y devuelve `items=[]`.

## 7. Resolución de wallet desde caption

### 7.1 Algoritmo

```ts
function resolveWalletFromCaption(
  caption: string | undefined,
  activeWallets: { id, name }[],
  defaultWalletId: string | null,
): { kind: 'resolved', walletId } | { kind: 'ask', candidates }
```

1. Normalizar caption: lowercase, sin acentos (NFD + strip combining marks), trim.
2. Normalizar `wallet.name` igual.
3. Match exact → si único, resolved.
4. Match substring bidireccional → si único, resolved.
5. Si caption no vacío y matches ≥ 2 → `ask` con esos candidatos.
6. Si caption no vacío y matches = 0 → `ask` con todas las wallets activas.
7. Si caption vacío y `defaultWalletId` válida y activa → resolved.
8. Si caption vacío y `activeWallets.length == 1` → resolved (esa).
9. Si caption vacío y sin default → `ask` con todas.

### 7.2 Selector inline

Cuando el resultado es `ask`:

- El bot inserta el batch con `suggested_wallet_id = null` en todas las filas.
- Manda un mensaje *"📋 Encontré N movimientos. ¿A qué wallet van?"* con N botones (uno por wallet candidata). Callback: `bwallet:<batch_id>:<wallet_id>`.
- Al tap: `update telegram_pending set suggested_wallet_id = $1 where batch_id = $2`, luego corre dedup (sección 8) y muestra el preview real (sección 9).
- Si pasan 10 minutos sin elegir wallet, las filas pending expiran via el cron.

## 8. Deduplicación

### 8.1 Cuándo corre

Después de extraer y de saber la wallet target (sea por caption o por selector). Antes de renderizar el preview.

### 8.2 Algoritmo (pairing 1:1)

```ts
async function deduplicateBatch(
  supabase, userId, walletId, items: ExpenseItem[], batchId: string
): Promise<DedupResult[]>
```

1. Calcular `minDate, maxDate` del batch. Si vacío, salir.
2. Una query (con UNION) trae existentes:

```sql
-- Tx confirmadas en la ventana
select id as ref_id, 'tx' as kind, type, amount, occurred_at
from transactions
where user_id = $1 and wallet_id = $2
  and type in ('expense','income')
  and occurred_at::date between $3::date - 1 and $4::date + 1

union all

-- Pending no excluidas de OTROS batches del mismo usuario
select id as ref_id, 'pending' as kind, (extraction->>'type')::text as type,
       (extraction->>'amount')::numeric as amount,
       coalesce((extraction->>'occurred_at')::timestamptz, created_at) as occurred_at
from telegram_pending
where user_id = $1
  and suggested_wallet_id = $2
  and batch_id is distinct from $5    -- el batch actual
  and excluded = false
  and expires_at > now()
```

3. Indexar por bucket `(date_local, amount, type)`. Cada tx/pending entra en su bucket.
4. Para cada `item` extraído en orden temporal:
   - `bucket = (item.date_local, item.amount, item.type)`
   - `candidates = índice[bucket]` no consumidos
   - Si `item.tiene_hora`: `match = primer candidate con |c.time - item.time| ≤ 1h`
   - Si no: `match = primer candidate (cualquier hora)`
   - Si match: `item.is_duplicate = true`, `item.duplicate_of_tx_id = match.ref_id` (solo si kind='tx'; si es pending, dejamos `duplicate_of_tx_id=null` pero marcamos dup).
5. Resultado se aplica al UPDATE de las filas pending recién insertadas.

### 8.3 Override

El preview tiene dos botones de confirm:
- **"Confirmar (excl dups)"** → `WHERE excluded = false AND is_duplicate = false`
- **"Confirmar TODO"** → `WHERE excluded = false` (incluye dups)

## 9. Preview UX

### 9.1 Formato del mensaje (MarkdownV2)

```
📋 *Encontré 24 movimientos* — Wallet: *Cuenta Nación*

  1. ✨ 13/05 · $15.100,00 · Makro · Comida › Supermercado
  2. ✨ 13/05 · $9.999,00 · Boot.dev · Educación
  3. 🔄 13/05 · $3.022,65 · AFIP percepción · Otros gastos
  4. ⚠️ 12/05 · $839,86 · SUBE · Transporte (dup 12/05)
  5. ✨ 11/05 · $26.598,01 · Pago Personal · Servicios
  6. 🔄 11/05 · $200.000,00 · DEBIN · transfer hint
  ...

📊 Resumen: 18 nuevos · 3 duplicados · 3 posibles transfers
💰 Total nuevo: $542.391,12 gastos · $200.000,00 ingresos
```

**Iconos**:
- ✨ nuevo (no dup, no transfer)
- ⚠️ duplicado (gana sobre transfer si ambos)
- 🔄 transfer hint (sin counterpart elegido)
- 🔁 transfer hint con counterpart asignado

**Paginación**: si el render excede 3800 chars (margen al cap 4096), partir en mensajes adicionales y dejar el inline keyboard solo en el último.

### 9.2 Inline keyboard

```
[ ✅ Confirmar (excl dups)      ]
[ ✅ Confirmar TODO              ]
[ ✏️ Excluir items              ] [ 🔄 Marcar transfers ]
[ ❌ Cancelar                    ]
```

Callback data:
- `bconf:<batch_id>` → confirmar excluyendo dups
- `bconfall:<batch_id>` → confirmar todo (incl dups)
- `bexcl:<batch_id>` → entrar a modo exclusión
- `btrans:<batch_id>` → entrar a modo transfer
- `bcanc:<batch_id>` → cancelar batch

Prefijos `b*` para no colisionar con los actuales `confirm:` / `edit:` / `cancel:`.

### 9.3 Flujo "Excluir items"

1. Usuario tapea `[✏️ Excluir items]`.
2. Bot upsertea `telegram_chat_state(chat_id, awaiting_exclude_batch_id=<batch_id>, expires_at=now()+2m)`.
3. Bot responde *"Mandá los números a excluir separados por coma (ej: 3,7,12) o `/cancel` para volver."*
4. El **text handler** chequea ANTES de extraer AI: si hay `awaiting_exclude_batch_id` para el chat, parsea el mensaje:
   - CSV de enteros válidos → `UPDATE telegram_pending SET excluded=true WHERE batch_id=$1 AND batch_index IN (...)`. Borra el flag. Re-renderiza el preview editando el mensaje original (vía `telegram_message_id`).
   - `/cancel` → borra el flag, no toca el batch.
   - Cualquier otra cosa → responde *"No entendí, mandá ej: 3,7,12 o /cancel"*. No borra el flag.
5. Si pasan 2 min sin reply válido, el flag expira y el text handler vuelve a comportarse normal.

### 9.4 Flujo "Marcar transfers"

1. Usuario tapea `[🔄 Marcar transfers]`. Solo aparece si hay items con `transfer_hint=true` Y el usuario tiene ≥2 wallets.
2. Bot upsertea `telegram_chat_state(chat_id, awaiting_transfer_batch_id=<batch_id>)`.
3. Bot manda un mensaje listando solo los items con `transfer_hint=true`. Cada item con su propio inline keyboard de wallets contraparte (excluye la wallet target del batch). Callback: `btrset:<pending_id>:<wallet_id>`.
4. Cada tap: `update telegram_pending set counterpart_wallet_id=$1 where id=$2`. Edita el mensaje del item a `🔁 transfer → <wallet>`.
5. Botón final `[← Volver al preview]` o `[Listo]`. Re-renderiza el preview principal con los iconos actualizados.

### 9.5 Confirmación final

Al tapear "Confirmar (excl dups)" o "Confirmar TODO":

1. SELECT de las filas pending del batch según el filtro.
2. Wrap en transacción Postgres (`begin; ... commit;`):
   - Para cada fila con `counterpart_wallet_id != null`: insertar como **transfer** (2 filas en `transactions` con mismo `transfer_group_id`, lógica reusada de `actions/transfers.ts:createTransfer`).
   - Para el resto: insertar como expense/income usando `createTransactionFromPending` existente.
   - Si CUALQUIER insert falla, rollback total.
3. DELETE todas las filas del batch en `telegram_pending`.
4. Edit del mensaje de preview a:

```
✅ 18 movimientos guardados
   ❌ 3 duplicados omitidos
   ↩️ 3 excluidos por vos
```

5. `answerCallbackQuery({ text: 'Listo' })`.

## 10. Manejo de errores

### 10.1 Extractor
- `AiExtractionError` con `items=[]` o `source_kind='unknown'` → reply *"No pude leer movimientos. Probá otra foto o explicámelo en texto."* No persiste pending.
- Timeout/5xx Gemini → reply genérico + log estructurado. El usuario reintenta.
- Items que individualmente fallan Zod (monto null, fecha inválida) → se descartan; el preview muestra los válidos + nota *"(N items omitidos por datos incompletos)"*.

### 10.2 Wallet
- Caption matchea wallet archivada → tratada como "no match", cae a selector.
- Usuario sin wallets activas → *"Primero creá una wallet en la app"*.

### 10.3 Confirm
- Wallet target archivada/borrada entre preview y confirm → falla todo el batch, reply *"La wallet ya no está disponible. Cancelé el batch."* y se borran las pending.
- Insert falla en medio del batch → rollback Postgres, reply *"Error guardando. Probá de nuevo."* — las pending quedan, el usuario reintenta.
- Batch expirado (>15min) → callback responde *"Este batch expiró. Mandalo de nuevo."* y borra residuales.

### 10.4 Transfers
- Counterpart en moneda distinta a la wallet target → lookup en `fx_rates` (reusa helper de `actions/transfers.ts`). Si no hay rate, fallback: persistir como expense en wallet origen e income en wallet destino (no atómico como transfer, pero ambas wallets quedan reflejadas).
- Si el usuario tiene 1 sola wallet, el botón "Marcar transfers" no aparece.

### 10.5 Exclusión
- Índices fuera de rango (ej "1,7,99" con 24 items) → ignora los inválidos, responde *"Excluí 1 y 7. El 99 no existe."*.
- Dos batches simultáneos: el "modo exclusión" se setea sobre el último; solo uno por chat a la vez.

## 11. Seguridad

- Callback handlers verifican `chat_id == pending.telegram_chat_id` (igual que `confirm.ts` actual). Un UUID forwardeado no se puede actuar desde otro chat.
- `telegram_chat_state` scopeado por `telegram_chat_id`.
- `telegram_pending` y `telegram_chat_state` con RLS habilitado pero sin policies públicas → service-role only.

## 12. Observabilidad

Log estructurado en cada paso del batch:
```json
{
  "batch_id": "uuid",
  "user_id": "uuid",
  "source_kind": "bank_statement",
  "items_extracted": 24,
  "items_dup": 3,
  "items_excluded": 0,
  "items_persisted": 21,
  "items_failed": 0,
  "wallet_target": "Cuenta Nación",
  "ai_latency_ms": 4321
}
```

Sirve para detectar prompt drift cuando el modelo empiece a fallar en patterns nuevos.

## 13. Cleanup

El cron existente que reapa `telegram_pending` expirado se extiende para también limpiar `telegram_chat_state` con `expires_at < now()`. Implementación trivial: agregar `delete from telegram_chat_state where expires_at < now()`.

## 14. Trabajo futuro (post-v1)

- Auto-match cross-screenshot de transfers (matchear un débito en Nación con un crédito en MP por monto+fecha).
- Edición de campos individuales por item vía inline keyboard (hoy redirige a la web app).
- Soporte para multi-page del mismo statement con auto-join inteligente (hoy se basa en dedup, que funciona pero requiere overlap mínimo).
- Ampliación del set de payees normalizados a un JSON externo con loop de feedback.
- Detección de wallet por contenido del screenshot (OCR de logo Mercado Pago, encabezado banco).

## 15. Plan de implementación

A definir en el siguiente paso usando la skill `writing-plans`. Estructura tentativa:

1. **Wave A — Schema y core**: migración 0010, schema Zod, refactor de `extract-expense.ts` (batch + wrappers), update de `category-resolver.ts` con subcategoría.
2. **Wave B — Wallet resolution + dedup**: helper `resolveWalletFromCaption`, helper `deduplicateBatch`, integración en handlers existentes.
3. **Wave C — Handlers + preview**: refactor de `photo.ts` / `text.ts` / `voice.ts` para llamar batch; nuevo `lib/telegram/preview-batch.ts`; nuevo handler `lib/telegram/handlers/batch-callback.ts`.
4. **Wave D — Modos exclusión y transfer**: `telegram_chat_state` upsert + lookup, modificación del text handler para chequear el flag antes de extraer AI, sub-handler de transfers.
5. **Wave E — Confirm atómico + tests**: refactor de `confirm.ts` para soportar batch (mantener handler legacy para callbacks viejos), tests E2E con fixtures de los dos screenshots.
