"use client";

import * as React from "react";
import { Plus } from "@phosphor-icons/react";

import { createCategory } from "@/actions/categories";
import { CategoryForm } from "@/components/categories/category-form";
import type { CategoryFormParentOption } from "@/components/categories/category-form";
import { Button } from "@/components/ui/button";
import type { CategoryType } from "@/lib/supabase/database.types";
import { t } from "@/lib/i18n";

interface NewCategoryButtonProps {
  /** Pre-fills the type tab when the modal opens. */
  defaultType: CategoryType;
  parentOptions: CategoryFormParentOption[];
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  label?: string;
}

/**
 * Trigger button + modal pair for creating a new category. Owns its own
 * open-state so it can be dropped into either the desktop heading or the
 * mobile FAB-like slot. Receives `parentOptions` from the server-rendered
 * page so the picker reflects the latest user data without re-fetching.
 */
export function NewCategoryButton({
  defaultType,
  parentOptions,
  className,
  variant = "default",
  size = "default",
  label,
}: NewCategoryButtonProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        onClick={() => setOpen(true)}
      >
        <Plus weight="bold" className="h-4 w-4" />
        <span>{label ?? t.category.new}</span>
      </Button>
      <CategoryForm
        open={open}
        onOpenChange={setOpen}
        parentOptions={parentOptions}
        config={{
          mode: "create",
          defaultType,
          onSubmit: async (input) => createCategory(input),
        }}
      />
    </>
  );
}
