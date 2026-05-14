# Siri Shortcut — Voz a Agente

**Estado:** Spec aprobado, listo para plan de implementación
**Fecha:** 2026-05-14

## Resumen

Agregar una vía de entrada por voz al tracker: el usuario invoca un Atajo de
iOS con Siri, dicta un comando en lenguaje natural (gastos, ingresos,
transferencias, queries), y un endpoint HTTP nuevo (`POST /api/voice/agent`)
delega al mismo `runExpenseAgent` que ya usa el bot de Telegram. La respuesta
en texto vuelve al iPhone y Siri la lee en voz alta.

Reusa el agente y sus tools end-to-end. Lo único nuevo es la capa de
auth (tokens estilo PAT), el endpoint y la UI de Settings para gestionarlos.

## Motivación

El bot de Telegram ya cubre el caso "anotar gasto desde el teléfono", pero
requiere abrir la app. Con Siri se hace manos-libres y sin contexto previo:
útil al volver del super, manejando, o cuando el celular está en el bolsillo.

## Decisiones de diseño

| Decisión | Elegido | Alternativa descartada |
|---|---|---|
| Auth | Token largo (PAT) pegado en el Atajo | OTP estilo Telegram |
| Multi-turno | One-shot, agente asume defaults | Loop con sessionId |
| UX del Atajo | Fire-and-forget (sin confirmación) | Preview + confirmar |
| Scope de capacidades | Todo lo que hace el agente | Solo agregar gastos |
| Almacenamiento de tokens | Tabla `voice_tokens` dedicada | Columna en `telegram_users` |

## Arquitectura

```
iPhone (Siri)              Vercel (Next.js)              Supabase
─────────────              ────────────────              ────────
"Hey Siri, agregar gasto"
  │
  ├─ Atajo: Pedir entrada   →  dictado
  │
  └─ POST /api/voice/agent
     Authorization: Bearer vt_…
     body: { text }
                                  │
                                  ├─ sha256(token) → lookup voice_tokens
                                  │                              ├─ user_id, default_wallet_id
                                  │
                                  ├─ runExpenseAgent({ supabase, userId,
                                  │     chatId: -1, mainCurrency, text })
                                  │                              ├─ agente corre sus tools
                                  │
                                  └─ { ok: true, text: "✅ Anotado $500 en Comida" }
  │
  └─ Atajo: Hablar texto  →  Siri lee la respuesta
```

**Endpoint sincrónico** (a diferencia del webhook de Telegram, que usa
`after()`): el Atajo necesita la respuesta para que Siri la diga. Corre
dentro del `maxDuration: 300` del runtime Node.

**`chatId: -1`** como sentinel para invocaciones de voz. La columna existe en
`telegram_agent_actions` y tolera el valor; si genera ruido a futuro, se
agrega columna `source` al action log.

**Defaults de wallet:** el tool de creación de movimiento, cuando el modelo
no resuelve `wallet_id`, busca primero `voice_tokens.default_wallet_id` para
el user; si tampoco existe, cae al primer wallet del usuario.

## Modelo de datos

Migración nueva: `supabase/migrations/<timestamp>_voice_tokens.sql`

```sql
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

create policy "voice_tokens_owner_select" on public.voice_tokens
  for select using (auth.uid() = user_id);

create policy "voice_tokens_owner_delete" on public.voice_tokens
  for delete using (auth.uid() = user_id);
```

- **Token plano:** prefijo `vt_` + 32 bytes random base64url (~43 chars).
- **Hash:** sha256 hex. El plano nunca se persiste; se muestra una sola vez
  al usuario en la UI tras crearlo.
- **Lookup del endpoint:** usa admin client (service role) que bypasea RLS,
  porque la request del iPhone no tiene sesión Supabase.
- **Revocación:** soft-delete con `revoked_at`. El lookup filtra
  `revoked_at IS NULL`. No se borra la fila para preservar auditoría de
  `last_used_at`.

## Componentes

### 1. Endpoint `POST /api/voice/agent`

`app/api/voice/agent/route.ts`

```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

POST(req):
  1. Validar Bearer token → si falta o malformado: 401
  2. sha256(plano) → SELECT * FROM voice_tokens WHERE token_hash=? AND revoked_at IS NULL
     → si no existe: 401
  3. UPDATE last_used_at = now() (best-effort, no bloquea respuesta)
  4. Parsear body con Zod: { text: string (min 1, max 2000) }
     → si inválido: 400
  5. SELECT main_currency FROM profiles WHERE id = user_id
     → si no existe: 500 con texto genérico
  6. runExpenseAgent({ supabase: admin, userId, chatId: -1,
                       mainCurrency, text })
  7. 200 { ok: true, text }
  8. Errores:
     - AgentQuotaError → 200 { ok: false, text: "Mi cuota AI llegó al límite. Probá mañana." }
     - Otros          → 200 { ok: false, text: "Algo falló procesando. Probá de nuevo." }

  Devolvemos 200 con `ok: false` en errores recuperables para que el Atajo
  siempre pueda leer el texto. Solo devolvemos no-2xx en errores de auth
  o request malformado.
```

### 2. Server actions

`actions/voice-tokens.ts` — calcado del patrón de `actions/telegram.ts`:

- `createVoiceToken({ label, default_wallet_id }): ActionResult<{ token: string }>`
  - Auth: requiere sesión Supabase del user.
  - Genera plano, calcula hash, inserta row, devuelve plano UNA vez.
- `revokeVoiceToken(id): ActionResult`
  - Auth: requiere sesión. Verifica `user_id` matchea con `auth.uid()`.
  - Soft-delete: `UPDATE voice_tokens SET revoked_at = now() WHERE id=? AND user_id=?`.
- `listVoiceTokens(): ActionResult<TokenRow[]>` — para hidratar la UI sin
  exponer hashes.

### 3. UI `/settings/voice`

Página nueva. Patrón calcado de `/settings/telegram`. Componentes:

- Lista de tokens activos (label, last_used_at, botón Revocar).
- Botón "Generar nuevo token" → form con label + select de wallet por defecto.
- Tras crear: panel con el token plano + botón copiar + mensaje "Se muestra
  solo esta vez".
- Sección colapsable "Cómo configurar el Atajo de iOS" con los pasos abajo.

### 4. Guía del Atajo (texto embebido en la UI)

```
1. App Atajos → +
2. "Pedir entrada"
     Pregunta: ¿Qué gasto?
     Tipo:     Texto
3. "Obtener contenido de URL"
     URL:      https://<tu-dominio>/api/voice/agent
     Método:   POST
     Encabezados:
       Authorization: Bearer <token>
       Content-Type:  application/json
     Cuerpo de la solicitud (JSON):
       text: <Texto proporcionado>      ← variable del paso 2
4. "Obtener valor del diccionario" → Clave: text
5. "Hablar texto" → <resultado del paso 4>
6. Nombre: Agregar gasto
7. Activar "Usar con Siri"
```

No se distribuye un archivo `.shortcut` en v1 (overhead de hostearlo + cada
user tiene su propio dominio/token). Si más adelante se justifica, se agrega.

## Tests

Patrón vitest existente.

- `tests/api/voice-agent.test.ts`
  - 401 sin Authorization header
  - 401 con token inválido
  - 401 con token revocado
  - 400 con body sin `text`
  - 200 happy path: delega a `runExpenseAgent` mockeado, devuelve `{ ok, text }`
  - 200 con AgentQuotaError → `{ ok: false, text: "..." }`
  - `last_used_at` se actualiza tras hit válido

- `tests/actions/voice-tokens.test.ts`
  - `createVoiceToken` guarda hash, NO el plano (assert `token_hash !== plano`)
  - `createVoiceToken` requiere sesión auth
  - `revokeVoiceToken` setea `revoked_at`, no borra la fila
  - `revokeVoiceToken` rechaza tokens de otros users

No tests del agente: ya cubierto por la suite de Telegram (el agente es el
mismo módulo, esto es solo un transport nuevo).

## No incluido (out of scope para v1)

- **Multi-turno con follow-ups.** Si el agente no resuelve con defaults, la
  respuesta dice qué falta y el user re-dicta. No hay sessionId.
- **Imágenes / audio attachments.** Solo texto. Tickets se siguen mandando
  por Telegram.
- **Archivo `.shortcut` descargable.** Guía manual basta.
- **App Shortcuts nativos / App Intents.** Requiere app iOS con cuenta de
  desarrollador. Out of scope.
- **Rate limiting per-token.** El runtime de Vercel y el rate limit del
  modelo de Gemini ya capean el daño realista. Se agrega si es necesario.
- **Auditoría visual de invocaciones de voz.** Por ahora caen al mismo log
  de `telegram_agent_actions` con `chatId: -1`. Si se necesita separar,
  agregar columna `source` en una migración posterior.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Token plano se filtra (Atajo compartido, captura de pantalla) | Soft-revoke desde Settings con un click; `last_used_at` permite detectar uso anómalo. |
| `chatId: -1` rompe alguna query del action log que asume positivo | Verificar en implementación; si rompe, agregar columna `source`. |
| Agente tarda > 300s (timeout de la función) | Mismo riesgo que Telegram. Sin mitigación nueva. La respuesta de Siri "no se pudo procesar" es aceptable. |
| El agente devuelve texto vacío | `runExpenseAgent` ya tiene `FALLBACK_REPLY`; la API lo propaga. |

## Plan de rollout

1. Migración + tipos.
2. Endpoint + tests.
3. Server actions + tests.
4. UI Settings.
5. Manual: armar el Atajo en el iPhone, validar happy path y un par de
   errores (token revocado, body raro).
6. Merge a `main`.
