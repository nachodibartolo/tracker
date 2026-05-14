# Quick Category Edit — Diseño

**Fecha:** 2026-05-14
**Autor:** Nacho (con Claude)
**Estado:** Aprobado, listo para plan de implementación

---

## 1. Motivación

El menú de 3 puntitos en `<TransactionRow>` (lista `/transactions` y dashboard) hoy ofrece solo "Editar" (que navega a la página completa de edición) y "Eliminar". Re-categorizar una transacción mal clasificada por el bot de Telegram es lo más común en uso real, y obliga a navegar a otra página solo para tocar un select. Queremos un atajo: cambiar **categoría** y **subcategoría** sin salir de la lista.

## 2. Objetivos

- Agregar un ítem **"Editar categoría"** al menú de 3 puntitos entre "Editar" y "Eliminar".
- Al elegirlo, abrir un modal/drawer (`<ResponsiveModal>`) con dos selects: **Categoría** (top-level) y **Subcategoría** (si la categoría tiene hijos).
- Pre-llenar con los valores actuales de la transacción.
- Guardar con `updateTransaction(id, { category_id })` reutilizando la acción existente.
- Funcionar idéntico en `/transactions` y en el dashboard.

## 3. No-objetivos (v1)

- Editar otros campos (descripción, payee, monto, fecha, tipo, wallet) — para eso ya está la página completa.
- Cambiar el `type` de la transacción (gasto ↔ ingreso). El modal muestra solo categorías del tipo actual.
- Multi-selección o edición en lote. Una transacción a la vez.
- Exponer este atajo en transferencias (`type: "transfer"` — ya no entra por `TransactionRow` regular, igual lo protegemos).

## 4. Arquitectura

Tres cambios chicos:

```
TransactionRow (3-dot menu)
   │
   ├── "Editar"            → /transactions/${id}        (sin cambios)
   ├── "Editar categoría"  → <QuickCategoryEdit>        ◄── NUEVO
   └── "Eliminar"          → AlertDialog + deleteTx     (sin cambios)

<QuickCategoryEdit>  (client component)
   │
   ├── ResponsiveModal (Dialog en desktop, Drawer en mobile)
   │     ├── Select "Categoría"     (top-level del type actual)
   │     └── Select "Subcategoría"  (solo si hay hijos)
   │
   ├── Lazy fetch al primer open → getMyCategoryOptions(type)
   │
   └── Submit → updateTransaction(id, { category_id })
         + toast + router.refresh() + cierra modal
```

## 5. Componentes y archivos

### 5.1 Nuevo: `components/transactions/quick-category-edit.tsx`

Client component. Props:

```ts
interface QuickCategoryEditProps {
  transactionId: string;
  txType: "expense" | "income";
  currentCategoryId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
```

Estado interno:
- `categories: FlatCategoryOption[] | null` — lazy-cargadas al primer open
- `loading: boolean` — para el primer fetch
- `parentId: string | null` y `subId: string | null` — selección actual
- `pending: boolean` (vía `useTransition`) — durante el submit

Lógica:
- Al `open === true` por primera vez y `categories === null`, llamar `getMyCategoryOptions(txType)`.
- Derivar `parentId` y `subId` iniciales desde `currentCategoryId` y la lista (mismo cálculo que `transaction-form.tsx` líneas 109-115: si la categoría tiene `parent_id`, ese es el parent y la categoría actual es el sub; si no tiene `parent_id`, es el parent y el sub queda `null`).
- Si el parent cambia, resetear `subId` a `null`.
- `subcategoryOptions` derivadas de `categories.filter(c => c.parent_id === parentId)`.
- Submit: `category_id = subId ?? parentId ?? null` y llamar `updateTransaction`.

Renderiza dos `<Select>` y dos botones (Cancelar/Guardar) — copia visualmente la sección de categoría del `<TransactionForm>` para consistencia.

### 5.2 Nueva server action: `actions/categories.ts`

Archivo nuevo (no existe `actions/categories.ts` hoy).

```ts
"use server";

export async function getMyCategoryOptions(
  type: "expense" | "income",
): Promise<ActionResult<FlatCategoryOption[]>>;
```

Implementación:
- Valida `type`.
- `requireUser()` (helper privado, igual al de `actions/transactions.ts` — se puede extraer a `lib/supabase/require-user.ts` si conviene, pero para v1 lo duplicamos a propósito para no ampliar scope).
- Llama `getFlatCategoryOptions(supabase, userId, type)` (ya existente en `lib/domain/categories.ts`).
- Devuelve `{ ok: true, data: options }` o `{ ok: false, error }`.

### 5.3 Cambios en `components/transactions/transaction-row.tsx`

- Importar `QuickCategoryEdit` y un ícono de Phosphor (ej. `FolderOpen` o `Tag`).
- Agregar `const [quickCatOpen, setQuickCatOpen] = React.useState(false);`.
- Insertar `<DropdownMenuItem onClick={() => setQuickCatOpen(true)}>` entre "Editar" y el `<DropdownMenuSeparator />`. Solo se renderiza si `row.type !== "transfer"` (guarda defensiva).
- Renderizar `<QuickCategoryEdit ... />` al lado del `<AlertDialog>` de eliminar.
- Etiqueta del ítem: `"Editar categoría"` (agregar a `lib/i18n.ts` como `t.transaction.editCategory`).

### 5.4 Cambios en `lib/i18n.ts`

Agregar una clave en `transaction:`:

```ts
editCategory: "Editar categoría",
```

## 6. Flow de datos

```
[Click "Editar categoría"] ──► setQuickCatOpen(true)
                                    │
                                    ▼
                          <ResponsiveModal open>
                                    │
                  ┌─────────────────┴─────────────────┐
                  ▼                                   ▼
       categories === null?                  categories != null
                  │                                   │
                  ▼                                   ▼
       getMyCategoryOptions(txType)         (skip fetch)
                  │
                  ▼
            setCategories(data)
                  │
                  ▼
       derivar parentId/subId iniciales ◄────────────┘
                  │
                  ▼
       [user edita selects]
                  │
                  ▼
       [Click "Guardar"]
                  │
                  ▼
       updateTransaction(id, {
         category_id: subId ?? parentId ?? null
       })
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
       ok                error
        │                   │
        ▼                   ▼
   toast.success      toast.error
   router.refresh()   (mantiene modal abierto)
   onOpenChange(false)
```

## 7. Decisión: lazy-fetch vs prop drilling

**Elegido: lazy-fetch on first open.**

Considerado pasar `categoryOptions` desde `/transactions/page.tsx` (que ya las fetchea) y `/dashboard/page.tsx` (que **no** las fetchea hoy) a través de `<TransactionList>` → `<TransactionRow>` y `<RecentTransactions>` → `<TransactionRow>`.

Trade-offs:

| Aspecto              | Lazy-fetch                       | Prop drilling                            |
|----------------------|----------------------------------|------------------------------------------|
| Cambios en API       | Solo `<TransactionRow>`          | 4 componentes + 2 server pages           |
| Carga del dashboard  | Sin cambio                       | +1 query siempre (incluso sin abrir)     |
| Latencia primera vez | ~50ms (1 query corta)            | 0ms                                      |
| Re-fetch al re-abrir | No (cacheado en state local)     | N/A                                      |

50ms en la primera apertura es invisible en mobile. La opción lazy mantiene la API de `<TransactionRow>` simple (sigue recibiendo solo `row`).

## 8. Validación y errores

Reutilizamos toda la lógica del backend (`updateTransaction`):

- Ownership de la transacción (filtro `user_id`).
- Ownership de la categoría nueva (filtro `user_id`).
- Match de `type` (categoría debe coincidir con el `type` de la tx) — ya garantizado porque el picker solo muestra categorías del `txType`.
- Si llega `category_id: null`, se borra la categoría (válido).

Errores se muestran con `toast.error(result.error)` y el modal queda abierto para reintentar.

## 9. Mobile-first

- En mobile, `<ResponsiveModal>` ya rendera `<Drawer>` (deslizable desde abajo) — touch targets cómodos.
- En desktop renderea `<Dialog>` centrado.
- Los `<Select>` ya están dimensionados ≥ 44px en el resto de la app.

## 10. Tests / verificación manual

Plan de verificación al final (no automatizamos para v1):

1. Click 3 puntitos en una transacción de gasto con categoría asignada → abrir modal → cambiar a otra categoría sin subcategoría → guardar → ver chip actualizado en la row.
2. Misma transacción → abrir modal → cambiar a categoría con hijos → elegir un sub → guardar → ver subcategoría reflejada.
3. Transacción sin categoría → elegir una → guardar → ver categoría y color.
4. Transacción con categoría → elegir "Sin categoría" como parent → guardar → ver icono fallback (gris, +/-).
5. Probar en gasto **y** ingreso (verifica que sólo aparecen categorías del tipo correcto).
6. Probar en mobile (drawer) y desktop (dialog).
7. Probar desde dashboard (RecentTransactions) y desde `/transactions`.

## 11. Riesgos

- **Stale categoryOptions**: si el user crea/borra una categoría en otra pestaña mientras el modal está abierto, la lista no refresca. Aceptable para v1; el siguiente open re-fetchea (porque el state se reinicia al cerrar el modal — ver §13).
- **Doble click en "Guardar"**: prevenido por `pending` flag durante `useTransition`.

## 12. Out-of-scope explícito

- Animación o transición especial entre opciones del menú.
- Re-orden del menú: el orden "Editar / Editar categoría / Eliminar" es definitivo.
- Atajos de teclado.

## 13. State reset al cerrar

Al cerrar el modal sin guardar, el state interno (`parentId`, `subId`) se descarta — la próxima apertura se inicializa de cero desde `currentCategoryId`. Esto permite también recargar la lista de categorías si se cambian en otra pestaña: usamos un `useEffect` que resetea `categories` a `null` al `open: false → true` solamente si pasó >5min desde el último fetch (opcional, lo decidimos en el plan).

Default seguro v1: cachear `categories` toda la vida del componente. La row no se desmonta seguido (es parte de la lista) así que es trivial. Si surge feedback, lo iteramos.
