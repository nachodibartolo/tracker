# Tracker

App personal de tracking de gastos. Multi-wallet, multi-currency, bot de Telegram con IA para registrar gastos por texto/foto/audio. Inspirada en **Wallet by BudgetBakers**.

**Stack:** Next.js 16 App Router · TypeScript · shadcn/ui (base-ui) · Tailwind v4 · Supabase (Postgres + Auth + Storage) · grammY · AI SDK v6 + Google Gemini · Frankfurter (FX) · Vercel.

Mobile-first PWA, $0/mes en free tiers.

---

## Desarrollo local

```bash
pnpm install
cp .env.example .env.local         # las vars quedan vacías al inicio
pnpm dev                            # http://localhost:3000
```

Antes de provisionar Supabase la app levanta igual: el middleware salta el auth-gate y todas las páginas tienen un "empty path" pre-provisioning. Útil para iterar UI sin DB.

Si querés probar contra una Supabase local con Docker:

```bash
pnpm dlx supabase start
pnpm dlx supabase db reset         # aplica supabase/migrations/*
# Completá NEXT_PUBLIC_SUPABASE_URL + ANON_KEY + SERVICE_ROLE en .env.local
```

Scripts útiles:

```bash
pnpm typecheck     # tsc --noEmit
pnpm lint
pnpm build         # production build
pnpm dlx supabase gen types typescript --linked > lib/supabase/database.types.ts
```

---

## Deploy (Wave 6 — provisioning GitOps)

> Supabase nace al final, no durante el dev. Las migraciones viven en `supabase/migrations/` y se auto-aplican cuando conectás el proyecto a GitHub.

### 1. Subir a GitHub

```bash
git remote add origin git@github.com:<usuario>/tracker.git
git push -u origin main
```

### 2. Importar en Vercel

- En [vercel.com/new](https://vercel.com/new) importar el repo.
- El primer deploy va a fallar (sin env vars). Es esperado.

### 3. Instalar Supabase desde el Vercel Marketplace

- Project → Storage → Browse Marketplace → **Supabase** → Install.
- Vercel provisiona un proyecto Supabase nuevo y auto-inyecta:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`

### 4. Conectar Supabase ↔ GitHub para auto-migraciones

En el dashboard del proyecto Supabase recién creado:

- Project Settings → Integrations → **GitHub** → Connect.
- Branch: `main`. Migration path: `supabase/migrations/`.
- "Push migrations" una vez para aplicar las migraciones existentes.

A partir de ahí cualquier `git push` que toque `supabase/migrations/` se aplica solo.

### 5. Env vars restantes en Vercel

| Var | Cómo conseguirla |
|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) → Get API key. Free tier ~1500 req/día Flash 2.5. |
| `TELEGRAM_BOT_TOKEN` | [@BotFather](https://t.me/BotFather) → `/newbot`. Guardá el username también. |
| `TELEGRAM_WEBHOOK_SECRET` | `openssl rand -hex 32` |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | El username del bot (sin `@`). |
| `NEXT_PUBLIC_APP_URL` | URL final del deploy. |

### 6. Redeploy en Vercel

Project → Deployments → último deploy → Redeploy.

### 7. Conectar el bot al webhook

```bash
APP_URL=https://tu-deploy.vercel.app
TOKEN=$TELEGRAM_BOT_TOKEN
SECRET=$TELEGRAM_WEBHOOK_SECRET

curl "https://api.telegram.org/bot$TOKEN/setWebhook" \
  -d "url=$APP_URL/api/telegram/webhook" \
  -d "secret_token=$SECRET"

curl "https://api.telegram.org/bot$TOKEN/setMyCommands" \
  -d 'commands=[{"command":"saldo","description":"Ver balance"},{"command":"ultimos","description":"Últimas 5 transacciones"}]'
```

### 8. Regenerar types desde Supabase remoto

```bash
pnpm dlx supabase login
pnpm dlx supabase link --project-ref <ref>
pnpm dlx supabase gen types typescript --linked > lib/supabase/database.types.ts
git add lib/supabase/database.types.ts && git commit -m "chore: sync supabase types" && git push
```

### 9. Smoke test mobile

Desde el celular abrir el deploy:

- Signup → dashboard vacío con bottom-nav.
- Crear wallet (ej. "Galicia ARS", saldo 50000).
- Tap FAB → "Nueva transacción" → crear gasto.
- Tap FAB → foto del recibo → comprimida client-side, subida a Storage.
- `/settings/telegram` → generar código → mandar `/start <código>` al bot.
- "150 cafe en Starbucks" al bot → preview → confirmar.
- Foto del ticket → preview → confirmar.
- Voz "gasté 300 en uber" → preview → confirmar.
- `/saldo` y `/ultimos` desde Telegram responden.
- "Add to Home Screen" en iOS Safari / Android Chrome.

---

## Notas

- **Costo:** $0/mes para uso personal. Supabase free pausa el proyecto a los 7 días sin actividad; el cron diario de FX (`/api/cron/refresh-fx` a las 05:00 UTC) hace de heartbeat.
- **RLS:** todas las tablas con `auth.uid() = user_id`. El bot usa service-role pero deriva el `user_id` siempre de `telegram_users` lookup, nunca del payload.
- **Mobile-first:** layout `<768px` es bottom-nav + FAB + drawers. Sidebar aparece en ≥md.
- **Next.js 16** marca `middleware.ts` como deprecated en favor de `proxy.ts`. Sigue funcionando; migrar es trivial.
- **Cmd / Ctrl + K** abre la command palette (drawer en mobile).

---

## Arquitectura

```
app/
  (auth)/  login · signup            ← email+password + magic link
  (app)/   dashboard · wallets · categories · transactions · transfers · settings
  api/     telegram/webhook          ← grammY POST
           cron/refresh-fx           ← diario, protegido con CRON_SECRET
components/
  ui/                                ← shadcn base-ui
  shared/                            ← app-sidebar · bottom-nav · fab · responsive-modal · command-palette
  dashboard · transactions · wallets · categories · transfers
lib/
  supabase/                          ← client · server · middleware · admin · database.types
  ai/                                ← Gemini extraction (text · image · audio)
  fx/                                ← Frankfurter + cache fx_rates
  domain/                            ← wallet-balance · list* · group* · dashboard aggregation
  telegram/                          ← bot + handlers (start · status · text · photo · voice · confirm)
actions/                             ← server actions por dominio
supabase/migrations/                 ← 0001..0008, auto-aplicadas vía Supabase↔GitHub
```

### Waves del MVP

- **Wave 0** — scaffold Next + shadcn + schema + Supabase clients.
- **Wave 1** — auth + app shell mobile-first.
- **Wave 2** (paralelo) — wallets · categorías · FX rates · AI core.
- **Wave 3** (paralelo) — transactions CRUD · telegram bot scaffold + linking.
- **Wave 4** (paralelo) — transfers · dashboard · telegram AI handlers (text/foto/voz/confirm).
- **Wave 5** — polish (error/loading boundaries · Cmd+K · PWA icon).
- **Wave 6** — provisioning + deploy (este README).
