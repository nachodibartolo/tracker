"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ColorPicker } from "@/components/shared/color-picker";
import { IconPicker } from "@/components/shared/icon-picker";
import { ResponsiveModal } from "@/components/shared/responsive-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  ActionResult,
  createCategory,
  updateCategory,
} from "@/actions/categories";
import type { Category, CategoryType } from "@/lib/supabase/database.types";
import { CATEGORY_ICON_NAMES, CATEGORY_ICONS } from "@/lib/category-icons";
import { DEFAULT_COLOR, PALETTE } from "@/lib/colors";
import { t } from "@/lib/i18n";

const HEX = /^#[0-9a-fA-F]{6}$/;

const formSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "El nombre es obligatorio")
    .max(40, "Máximo 40 caracteres"),
  type: z.enum(["expense", "income"]),
  parent_id: z.string().uuid().nullable(),
  color: z.string().regex(HEX, "Color inválido"),
  icon: z.string().refine((v) => CATEGORY_ICON_NAMES.includes(v), {
    message: "Ícono inválido",
  }),
});

type FormValues = z.infer<typeof formSchema>;

type CreateActionInput = Parameters<typeof createCategory>[0];
type UpdateActionPatch = Parameters<typeof updateCategory>[1];

export interface CategoryFormParentOption {
  id: string;
  name: string;
  type: CategoryType;
}

type CategoryFormMode =
  | {
      mode: "create";
      /** Default tab/type pre-selected when the modal opens. */
      defaultType: CategoryType;
      onSubmit: (input: CreateActionInput) => Promise<ActionResult<{ id: string }>>;
    }
  | {
      mode: "edit";
      category: Category;
      onSubmit: (patch: UpdateActionPatch) => Promise<ActionResult>;
    };

interface CategoryFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing categories that can act as a parent (top-level only, scoped by user). */
  parentOptions: CategoryFormParentOption[];
  /** Optional pre-selected parent for "Agregar subcategoría" flows (create mode only). */
  initialParentId?: string | null;
  config: CategoryFormMode;
}

const NO_PARENT = "__none__";

export function CategoryForm({
  open,
  onOpenChange,
  parentOptions,
  initialParentId = null,
  config,
}: CategoryFormProps) {
  const isEdit = config.mode === "edit";
  const initialType: CategoryType = isEdit ? config.category.type : config.defaultType;
  const initialValues: FormValues = isEdit
    ? {
        name: config.category.name,
        type: config.category.type,
        parent_id: config.category.parent_id,
        color: config.category.color,
        icon: config.category.icon,
      }
    : {
        name: "",
        type: initialType,
        parent_id: initialParentId,
        color: DEFAULT_COLOR,
        icon: "tag",
      };

  const form = useForm<FormValues>({
    // `zodResolver` has a known type-resolution quirk against zod 4 schemas
    // (the same one affecting `wallet-form.tsx`). Casting the schema avoids
    // an unrelated TS overload-mismatch error without changing runtime
    // behavior.
    resolver: zodResolver(formSchema as never),
    defaultValues: initialValues,
    mode: "onSubmit",
  });

  // When the modal re-opens with a different category/initialParent, reset
  // the form state so we don't bleed values from a previous invocation.
  React.useEffect(() => {
    if (open) {
      form.reset(initialValues);
    }
    // We intentionally exclude `form` to avoid resetting on every render and
    // depend on `open` + the identity of the underlying category/type/parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    isEdit ? config.category.id : null,
    isEdit ? null : config.defaultType,
    initialParentId,
  ]);

  const type = form.watch("type");
  const color = form.watch("color");
  const [submitting, setSubmitting] = React.useState(false);

  const filteredParentOptions = React.useMemo(() => {
    return parentOptions.filter((p) => {
      // Only top-level + same type. Also exclude self (edit mode) since a
      // category can't parent itself.
      if (p.type !== type) return false;
      if (isEdit && p.id === config.category.id) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentOptions, type, isEdit, isEdit ? config.category.id : null]);

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const result = isEdit
        ? await config.onSubmit({
            name: values.name,
            type: values.type,
            parent_id: values.parent_id,
            color: values.color,
            icon: values.icon,
          })
        : await config.onSubmit({
            name: values.name,
            type: values.type,
            parent_id: values.parent_id,
            color: values.color,
            icon: values.icon,
          });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(isEdit ? t.common.saved : t.category.new);
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : t.common.error;
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  });

  // When the type tab changes, clear the parent_id selection — a parent of
  // the other type would be invalid.
  const handleTypeChange = (next: CategoryType) => {
    form.setValue("type", next, { shouldDirty: true });
    const currentParent = form.getValues("parent_id");
    if (currentParent) {
      const stillValid = parentOptions.some(
        (p) => p.id === currentParent && p.type === next,
      );
      if (!stillValid) form.setValue("parent_id", null);
    }
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? t.category.edit : t.category.new}
    >
      <form onSubmit={onSubmit} className="space-y-5">
        {!isEdit ? (
          <div className="space-y-2">
            <Label>{t.category.type}</Label>
            <Tabs
              value={type}
              onValueChange={(v) => handleTypeChange(v as CategoryType)}
              className="w-full"
            >
              <TabsList className="w-full">
                <TabsTrigger value="expense">{t.category.expense}</TabsTrigger>
                <TabsTrigger value="income">{t.category.income}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="category-name">{t.category.name}</Label>
          <Input
            id="category-name"
            placeholder="Ej. Comida"
            autoComplete="off"
            {...form.register("name")}
            aria-invalid={!!form.formState.errors.name}
          />
          {form.formState.errors.name ? (
            <p className="text-xs text-destructive">
              {form.formState.errors.name.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="category-parent">{t.category.parent}</Label>
          <Controller
            control={form.control}
            name="parent_id"
            render={({ field }) => (
              <Select
                value={field.value ?? NO_PARENT}
                onValueChange={(v) =>
                  field.onChange(v === NO_PARENT ? null : (v as string))
                }
              >
                <SelectTrigger id="category-parent" className="w-full">
                  <SelectValue placeholder="Sin categoría padre" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PARENT}>Sin categoría padre</SelectItem>
                  {filteredParentOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>

        <div className="space-y-2">
          <Label>{t.category.color}</Label>
          <Controller
            control={form.control}
            name="color"
            render={({ field }) => (
              <ColorPicker value={field.value} onChange={field.onChange} />
            )}
          />
          {form.formState.errors.color ? (
            <p className="text-xs text-destructive">
              {form.formState.errors.color.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label>{t.category.icon}</Label>
          <Controller
            control={form.control}
            name="icon"
            render={({ field }) => (
              <IconPicker
                options={CATEGORY_ICONS}
                value={field.value}
                onChange={field.onChange}
                color={color}
              />
            )}
          />
          {form.formState.errors.icon ? (
            <p className="text-xs text-destructive">
              {form.formState.errors.icon.message}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t.actions.cancel}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? t.common.loading : t.actions.save}
          </Button>
        </div>
      </form>
    </ResponsiveModal>
  );
}

// Re-export the palette so consumers can verify the picker matches the
// server-side validation regex.
export { PALETTE };
