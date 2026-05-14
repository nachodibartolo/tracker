# Quick Category Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un ítem "Editar categoría" al menú de 3 puntitos de `<TransactionRow>` que abre un modal con dos selects (categoría + subcategoría) para re-categorizar la transacción sin salir de la lista.

**Architecture:** Aditivo. Nuevo componente cliente `<QuickCategoryEdit>` que renderiza un `<ResponsiveModal>` con la sección "categoría + subcategoría" copiada de `<TransactionForm>`. Carga lazy las categorías la primera vez que se abre vía nueva server action `getMyCategoryOptions(type)`. Reutiliza `updateTransaction(id, { category_id })` sin cambios en el backend.

**Tech Stack:** Next.js 16 App Router · React 19 · Supabase · Base UI (Select, DropdownMenu) · vaul (Drawer) · sonner (toast) · Phosphor icons · pnpm

**Spec:** `docs/superpowers/specs/2026-05-14-quick-category-edit-design.md`

**Verification approach:** El proyecto no tiene framework de tests. Cada tarea valida con `pnpm typecheck` y `pnpm lint`. La Task 5 corre la lista completa de verificación manual del spec §10 con el dev server.

---

## File structure

**Crear:**
- `components/transactions/quick-category-edit.tsx` — modal con selects de categoría/subcategoría

**Modificar:**
- `lib/i18n.ts` — agregar `t.transaction.editCategory`
- `actions/categories.ts` — agregar export `getMyCategoryOptions(type)`
- `components/transactions/transaction-row.tsx` — agregar ítem en el dropdown + render del modal

---

## Task 1: i18n key

**Files:**
- Modify: `lib/i18n.ts:35-57`

- [ ] **Step 1: Agregar la clave `editCategory` al objeto `transaction`**

Abrí `lib/i18n.ts` y agregá la línea después de `edit: "Editar transacción",` (alrededor de la línea 37):

```ts
  transaction: {
    new: "Nueva transacción",
    edit: "Editar transacción",
    editCategory: "Editar categoría",
    expense: "Gasto",
    // …resto sin cambios
  },
```

- [ ] **Step 2: Verificar typecheck**

Correr: `pnpm typecheck`
Expected: PASS sin errores.

- [ ] **Step 3: Commit**

```bash
git add lib/i18n.ts
git commit -m "feat(i18n): add transaction.editCategory string"
```

---

## Task 2: Server action `getMyCategoryOptions`

**Files:**
- Modify: `actions/categories.ts` (agregar al final del archivo)

- [ ] **Step 1: Agregar import**

Al tope de `actions/categories.ts`, sumar el import de `getFlatCategoryOptions` y el tipo:

```ts
import {
  getFlatCategoryOptions,
  type FlatCategoryOption,
} from "@/lib/domain/categories";
```

(Si ya hay un import desde `@/lib/domain/categories`, fusionalo.)

- [ ] **Step 2: Agregar la función al final del archivo**

```ts
/**
 * Devuelve las categorías del usuario actual para un tipo dado, en formato
 * plano (top-level + subcategorías con prefijo `"Parent › Child"`). Pensada
 * para selects on-demand desde componentes cliente — la página de transacciones
 * ya las fetchea server-side, así que esta acción cubre los lugares donde no
 * tenemos la lista pre-cargada (dashboard, recent-transactions).
 */
export async function getMyCategoryOptions(
  type: "expense" | "income",
): Promise<ActionResult<FlatCategoryOption[]>> {
  if (type !== "expense" && type !== "income") {
    return { ok: false, error: "Tipo inválido" };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { ok: false, error: "No autenticado" };
  }

  try {
    const options = await getFlatCategoryOptions(supabase, user.id, type);
    return { ok: true, data: options };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "No se pudieron cargar las categorías";
    return { ok: false, error: message };
  }
}
```

- [ ] **Step 3: Verificar typecheck + lint**

Correr en paralelo:
```bash
pnpm typecheck && pnpm lint
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add actions/categories.ts
git commit -m "feat(actions): add getMyCategoryOptions server action"
```

---

## Task 3: Componente `<QuickCategoryEdit>`

**Files:**
- Create: `components/transactions/quick-category-edit.tsx`

- [ ] **Step 1: Crear el archivo con el componente completo**

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { getMyCategoryOptions } from "@/actions/categories";
import { updateTransaction } from "@/actions/transactions";
import { ResponsiveModal } from "@/components/shared/responsive-modal";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FlatCategoryOption } from "@/lib/domain/categories";
import { t } from "@/lib/i18n";

interface QuickCategoryEditProps {
  transactionId: string;
  txType: "expense" | "income";
  currentCategoryId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const NO_CATEGORY = "__none__";

/**
 * Modal de edición rápida de categoría/subcategoría. Lazy-fetchea la lista
 * de categorías la primera vez que se abre y cachea en state interno. No
 * toca otros campos de la transacción.
 */
export function QuickCategoryEdit({
  transactionId,
  txType,
  currentCategoryId,
  open,
  onOpenChange,
}: QuickCategoryEditProps) {
  const router = useRouter();
  const [categories, setCategories] = React.useState<FlatCategoryOption[] | null>(
    null,
  );
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [parentId, setParentId] = React.useState<string | null>(null);
  const [subId, setSubId] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  // Lazy fetch al primer open.
  React.useEffect(() => {
    if (!open || categories !== null || loading) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void (async () => {
      const result = await getMyCategoryOptions(txType);
      if (cancelled) return;
      if (result.ok) {
        setCategories(result.data ?? []);
      } else {
        setLoadError(result.error);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, categories, loading, txType]);

  // Cuando se abre el modal Y ya tenemos categorías, derivamos parent/sub
  // desde currentCategoryId. Mismo cálculo que TransactionForm:
  //   - si la categoría actual tiene parent_id → ese es el parent, ella es el sub
  //   - si no → ella es el parent, sub = null
  React.useEffect(() => {
    if (!open || !categories) return;
    if (currentCategoryId) {
      const current = categories.find((c) => c.id === currentCategoryId);
      if (current) {
        const nextParent = current.parent_id ?? current.id;
        const nextSub = current.parent_id ? current.id : null;
        setParentId(nextParent);
        setSubId(nextSub);
        return;
      }
    }
    setParentId(null);
    setSubId(null);
  }, [open, categories, currentCategoryId]);

  // Particionar en top-level y children-by-parent.
  const { topLevelCategories, childrenByParent } = React.useMemo(() => {
    const top: FlatCategoryOption[] = [];
    const childMap = new Map<string, FlatCategoryOption[]>();
    for (const c of categories ?? []) {
      if (c.parent_id === null) {
        top.push(c);
      } else {
        const list = childMap.get(c.parent_id) ?? [];
        list.push(c);
        childMap.set(c.parent_id, list);
      }
    }
    return { topLevelCategories: top, childrenByParent: childMap };
  }, [categories]);

  const subcategoryOptions = parentId
    ? childrenByParent.get(parentId) ?? []
    : [];

  function handleParentChange(value: string) {
    const next = value === NO_CATEGORY ? null : value;
    setParentId(next);
    setSubId(null);
  }

  function handleSubChange(value: string) {
    setSubId(value === NO_CATEGORY ? null : value);
  }

  function handleSubmit() {
    const nextCategoryId = subId ?? parentId ?? null;
    startTransition(async () => {
      const result = await updateTransaction(transactionId, {
        category_id: nextCategoryId,
      });
      if (result.ok) {
        toast.success(t.common.saved);
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={t.transaction.editCategory}
    >
      <div className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando categorías…</p>
        ) : loadError ? (
          <p className="text-sm text-destructive">{loadError}</p>
        ) : (
          <>
            {/* Categoría (top-level) */}
            <div className="space-y-2">
              <Label htmlFor="quick-cat">{t.transaction.category}</Label>
              <Select
                value={parentId ?? NO_CATEGORY}
                onValueChange={handleParentChange}
              >
                <SelectTrigger id="quick-cat" className="w-full">
                  <SelectValue placeholder="Sin categoría">
                    {(value) => {
                      if (!value || value === NO_CATEGORY) return null;
                      const c = topLevelCategories.find((x) => x.id === value);
                      if (!c) return null;
                      return (
                        <span className="flex items-center gap-1.5">
                          <span
                            aria-hidden
                            className="inline-block size-2 rounded-full"
                            style={{ backgroundColor: c.color }}
                          />
                          <span className="truncate">{c.name}</span>
                        </span>
                      );
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CATEGORY}>Sin categoría</SelectItem>
                  {topLevelCategories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span
                        aria-hidden
                        className="inline-block size-2 rounded-full"
                        style={{ backgroundColor: c.color }}
                      />
                      <span className="truncate">{c.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Subcategoría — solo si el parent tiene hijos */}
            {subcategoryOptions.length > 0 ? (
              <div className="space-y-2">
                <Label htmlFor="quick-sub">{t.transaction.subcategory}</Label>
                <Select
                  value={subId ?? NO_CATEGORY}
                  onValueChange={handleSubChange}
                >
                  <SelectTrigger id="quick-sub" className="w-full">
                    <SelectValue placeholder="Sin subcategoría">
                      {(value) => {
                        if (!value || value === NO_CATEGORY) return null;
                        const c = subcategoryOptions.find((x) => x.id === value);
                        if (!c) return null;
                        return (
                          <span className="flex items-center gap-1.5">
                            <span
                              aria-hidden
                              className="inline-block size-2 rounded-full"
                              style={{ backgroundColor: c.color }}
                            />
                            <span className="truncate">{c.name}</span>
                          </span>
                        );
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CATEGORY}>Sin subcategoría</SelectItem>
                    {subcategoryOptions.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        <span
                          aria-hidden
                          className="inline-block size-2 rounded-full"
                          style={{ backgroundColor: c.color }}
                        />
                        <span className="truncate">{c.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {t.actions.cancel}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={pending || loading || loadError !== null}
          >
            {pending ? "Guardando…" : t.actions.save}
          </Button>
        </div>
      </div>
    </ResponsiveModal>
  );
}
```

- [ ] **Step 2: Verificar typecheck + lint**

Correr en paralelo:
```bash
pnpm typecheck && pnpm lint
```
Expected: PASS. Las claves `t.common.saved` (lib/i18n.ts:133), `t.actions.save` (línea 16), `t.actions.cancel` y `t.actions.edit`/`t.actions.delete` ya existen — no hace falta tocar i18n más allá de Task 1.

- [ ] **Step 3: Commit**

```bash
git add components/transactions/quick-category-edit.tsx
git commit -m "feat(transactions): add QuickCategoryEdit modal component"
```

---

## Task 4: Integrar `<QuickCategoryEdit>` en `<TransactionRow>`

**Files:**
- Modify: `components/transactions/transaction-row.tsx`

- [ ] **Step 1: Agregar imports**

En el bloque de imports de `transaction-row.tsx`:

1. Sumar `Tag` al import de `@phosphor-icons/react` (línea 6 actual):

```tsx
import { DotsThreeVertical, Pencil, Tag, Trash } from "@phosphor-icons/react";
```

2. Sumar el import del nuevo componente debajo del import de `transaction-edit-trigger` (o donde mejor encaje alfabéticamente — la convención del repo es agrupar imports por path):

```tsx
import { QuickCategoryEdit } from "@/components/transactions/quick-category-edit";
```

- [ ] **Step 2: Agregar state para el modal**

Dentro de `TransactionRow`, después de las líneas existentes `const [confirmOpen, setConfirmOpen] = React.useState(false);` y `const [menuOpen, setMenuOpen] = React.useState(false);` (líneas 53-54), sumar:

```tsx
  const [quickCatOpen, setQuickCatOpen] = React.useState(false);
```

- [ ] **Step 3: Insertar el `DropdownMenuItem` en el menú**

En el `<DropdownMenuContent>` (alrededor de la línea 214), insertar el ítem nuevo **entre** el ítem "Editar" y el `<DropdownMenuSeparator />`. El bloque queda así:

```tsx
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => router.push(`/transactions/${row.id}`)}
            >
              <Pencil />
              {t.actions.edit}
            </DropdownMenuItem>
            {row.type !== "transfer" ? (
              <DropdownMenuItem onClick={() => setQuickCatOpen(true)}>
                <Tag />
                {t.transaction.editCategory}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setConfirmOpen(true)}
            >
              <Trash />
              {t.actions.delete}
            </DropdownMenuItem>
          </DropdownMenuContent>
```

- [ ] **Step 4: Renderizar el modal al lado del `<AlertDialog>`**

Después del cierre de `</AlertDialog>` (al final del componente, antes del `</>`) pero **antes** del fragment cerrador, agregar:

```tsx
      {row.type !== "transfer" ? (
        <QuickCategoryEdit
          transactionId={row.id}
          txType={row.type === "income" ? "income" : "expense"}
          currentCategoryId={row.category?.id ?? null}
          open={quickCatOpen}
          onOpenChange={setQuickCatOpen}
        />
      ) : null}
```

El bloque final del componente queda con esta forma:

```tsx
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        {/* …existente sin cambios… */}
      </AlertDialog>

      {row.type !== "transfer" ? (
        <QuickCategoryEdit
          transactionId={row.id}
          txType={row.type === "income" ? "income" : "expense"}
          currentCategoryId={row.category?.id ?? null}
          open={quickCatOpen}
          onOpenChange={setQuickCatOpen}
        />
      ) : null}
    </>
  );
}
```

- [ ] **Step 5: Verificar typecheck + lint**

Correr en paralelo:
```bash
pnpm typecheck && pnpm lint
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/transactions/transaction-row.tsx
git commit -m "feat(transactions): wire QuickCategoryEdit into row menu"
```

---

## Task 5: Verificación manual en el navegador

**Files:**
- Nothing to modify.

- [ ] **Step 1: Levantar el dev server**

```bash
pnpm dev
```

- [ ] **Step 2: Iniciar sesión y abrir `/transactions`**

Asegurate de tener al menos 3 transacciones de gasto con categorías distintas (algunas con subcategoría, otras sin) y al menos 1 de ingreso. Si no, cargá unas pocas a mano.

- [ ] **Step 3: Ejecutar el checklist del spec §10**

Para cada caso, anotá si pasó o falló:

1. [ ] **Cambio simple**: 3 puntitos en una transacción de gasto con categoría → "Editar categoría" → cambiar a otra top-level sin hijos → Guardar. Verificar que el chip de categoría en la row se actualizó.
2. [ ] **Con subcategoría**: misma transacción → cambiar a una categoría con hijos → seleccionar un sub → Guardar. Verificar que el texto de la row muestra la subcategoría.
3. [ ] **Asignar a transacción sin categoría**: en una row sin categoría asignada, abrir el modal → elegir una → Guardar. Verificar que aparece el ícono + color de la nueva categoría.
4. [ ] **Quitar categoría**: en una con categoría, abrir modal → elegir "Sin categoría" en el primer select → Guardar. Verificar que la row pasa a icono fallback (gris, +/-).
5. [ ] **Tipo correcto en ingreso**: abrir modal en una transacción de **ingreso** → confirmar que solo aparecen categorías de tipo income.
6. [ ] **Mobile drawer**: redimensionar el viewport a <768px (o abrir desde celular). Confirmar que aparece un drawer (sheet desde abajo) y no un dialog centrado.
7. [ ] **Desktop dialog**: viewport ≥768px. Confirmar que aparece un dialog centrado.
8. [ ] **Dashboard**: ir a `/dashboard`, abrir 3 puntitos en una row de "Transacciones recientes" → "Editar categoría" → cambiar → Guardar. Verificar que vuelve a `/dashboard` con el cambio reflejado.
9. [ ] **Cancelar**: abrir modal, hacer cambios, hacer click en "Cancelar". Re-abrir y verificar que volvió al estado original (categorías actuales).
10. [ ] **Error de servidor (opcional)**: en DevTools, bloquear `/actions/categories` o forzar offline → abrir modal → ver mensaje de error. Reactivar la red → ver que reabriendo el modal recarga ok.

- [ ] **Step 4: Si todo pasa, commit final (si hubo ajustes) o cerrar**

Si surgieron pequeños ajustes durante la verificación manual, aplicalos y commiteá con `fix(transactions): …`. Si todo funcionó al primer intento, no hace falta commit adicional.

- [ ] **Step 5: Mergear el branch (si fue desarrollado aparte)**

Si el trabajo se hizo en un worktree o branch dedicado:

```bash
git checkout main
git merge --no-ff <branch-name>
```

Si se hizo directo en `main`, no aplica.

---

## Notas de implementación

- **Por qué `row.type === "income" ? "income" : "expense"`** en lugar de pasar `row.type` directo: el tipo `TransactionWithRefs["type"]` incluye `"transfer"`, pero ya filtramos transferencias antes de renderizar el modal. El cast explícito mantiene la API del modal limitada a `"expense" | "income"` sin caster ni `as`.
- **Por qué no pasamos `currentCategoryId` como `row.category?.id`**: el modelo de `TransactionWithRefs` lo expone como `row.category?.id` (la relación viene resuelta). Confirmá leyendo `lib/domain/transactions.ts` si dudás de la shape.
- **`router.refresh()`** invalida el route segment y re-fetchea los server components — los chips de categoría en las rows se actualizan sin full page reload.
- **No tocar el detalle de transacción** (`/transactions/[id]`): el `<TransactionEditTrigger>` que vive allí ya ofrece el form completo. Este modal es solo para list view.
