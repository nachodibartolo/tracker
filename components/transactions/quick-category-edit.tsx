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

  // Lazy fetch al primer open. Las setState live dentro del async IIFE para
  // que el cuerpo del effect no dispare cascading renders (react-hooks/set-state-in-effect).
  React.useEffect(() => {
    if (!open || categories !== null || loading) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setLoadError(null);
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
        // eslint-disable-next-line react-hooks/set-state-in-effect
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

  function handleParentChange(value: string | null) {
    const next = !value || value === NO_CATEGORY ? null : value;
    setParentId(next);
    setSubId(null);
  }

  function handleSubChange(value: string | null) {
    setSubId(!value || value === NO_CATEGORY ? null : value);
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
          <p className="text-sm text-muted-foreground">{t.common.loading}</p>
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
            {pending ? t.common.saving : t.actions.save}
          </Button>
        </div>
      </div>
    </ResponsiveModal>
  );
}
