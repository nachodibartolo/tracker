"use client";

import * as React from "react";
import { CaretRight, DotsThreeVertical } from "@phosphor-icons/react";
import { toast } from "sonner";

import {
  createCategory,
  deleteCategory,
  updateCategory,
} from "@/actions/categories";
import { CategoryForm } from "@/components/categories/category-form";
import type { CategoryFormParentOption } from "@/components/categories/category-form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CategoryWithChildren } from "@/lib/domain/categories";
import { getCategoryIcon } from "@/lib/category-icons";
import type { Category, CategoryType } from "@/lib/supabase/database.types";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface CategoryTreeProps {
  type: CategoryType;
  categories: CategoryWithChildren[];
  /** Top-level options of the matching type, used as parent candidates in edit/add-sub modals. */
  parentOptions: CategoryFormParentOption[];
}

interface EditState {
  open: boolean;
  category: Category | null;
}

interface AddSubState {
  open: boolean;
  parentId: string | null;
  type: CategoryType;
}

interface ConfirmState {
  open: boolean;
  category: Category | null;
}

/**
 * Renders the tree of categories for one tab. The list itself is plain DOM —
 * the visual hierarchy is achieved with `pl-9` indentation on children. Each
 * row exposes the same dropdown menu (Edit, Delete, +Add subcategory on
 * top-level rows). Hitting Delete on a `is_system=true` row triggers a toast
 * and bails before opening the confirm dialog.
 */
export function CategoryTree({
  type,
  categories,
  parentOptions,
}: CategoryTreeProps) {
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [editState, setEditState] = React.useState<EditState>({
    open: false,
    category: null,
  });
  const [addSubState, setAddSubState] = React.useState<AddSubState>({
    open: false,
    parentId: null,
    type,
  });
  const [confirmState, setConfirmState] = React.useState<ConfirmState>({
    open: false,
    category: null,
  });
  const [deletePending, startDeleteTransition] = React.useTransition();

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const openEdit = (category: Category) => {
    setEditState({ open: true, category });
  };

  const openAddSub = (parentId: string) => {
    setAddSubState({ open: true, parentId, type });
  };

  const attemptDelete = (category: Category) => {
    if (category.is_system) {
      toast.error("No podés eliminar una categoría del sistema");
      return;
    }
    setConfirmState({ open: true, category });
  };

  const confirmDelete = () => {
    if (!confirmState.category) return;
    const id = confirmState.category.id;
    startDeleteTransition(async () => {
      const result = await deleteCategory(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t.common.deleted);
      setConfirmState({ open: false, category: null });
    });
  };

  if (categories.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/30 p-8 text-center">
        <p className="text-sm text-muted-foreground">{t.common.empty}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {categories.map((node) => {
        const hasChildren = node.children.length > 0;
        const isOpen = !!expanded[node.id];

        return (
          <div key={node.id} className="rounded-2xl">
            <CategoryRow
              category={node}
              hasChildren={hasChildren}
              expanded={isOpen}
              isTopLevel
              onToggle={hasChildren ? () => toggleExpanded(node.id) : undefined}
              onEdit={() => openEdit(node)}
              onDelete={() => attemptDelete(node)}
              onAddSub={() => openAddSub(node.id)}
            />
            {hasChildren && isOpen ? (
              <ul className="mt-1 space-y-1">
                {node.children.map((child) => (
                  <li key={child.id}>
                    <CategoryRow
                      category={child}
                      hasChildren={false}
                      expanded={false}
                      isTopLevel={false}
                      onEdit={() => openEdit(child)}
                      onDelete={() => attemptDelete(child)}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}

      {/* Edit modal */}
      {editState.category ? (
        <CategoryForm
          open={editState.open}
          onOpenChange={(open) =>
            setEditState((s) => ({ ...s, open, category: open ? s.category : null }))
          }
          parentOptions={parentOptions}
          config={{
            mode: "edit",
            category: editState.category,
            onSubmit: async (patch) => updateCategory(editState.category!.id, patch),
          }}
        />
      ) : null}

      {/* Add-subcategory modal — opens in "create" mode pre-filled with parent_id. */}
      <CategoryForm
        open={addSubState.open}
        onOpenChange={(open) => setAddSubState((s) => ({ ...s, open }))}
        parentOptions={parentOptions}
        initialParentId={addSubState.parentId}
        config={{
          mode: "create",
          defaultType: addSubState.type,
          onSubmit: async (input) => createCategory(input),
        }}
      />

      {/* Delete confirmation */}
      <AlertDialog
        open={confirmState.open}
        onOpenChange={(open) =>
          setConfirmState((s) => ({
            open,
            category: open ? s.category : null,
          }))
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.common.confirmDelete}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmState.category
                ? `Vas a eliminar "${confirmState.category.name}". Las subcategorías también se borran.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePending}>
              {t.actions.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={confirmDelete}
              disabled={deletePending}
            >
              {deletePending ? t.common.loading : t.actions.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface CategoryRowProps {
  category: Category;
  hasChildren: boolean;
  expanded: boolean;
  isTopLevel: boolean;
  onToggle?: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddSub?: () => void;
}

function CategoryRow({
  category,
  hasChildren,
  expanded,
  isTopLevel,
  onToggle,
  onEdit,
  onDelete,
  onAddSub,
}: CategoryRowProps) {
  const Icon = getCategoryIcon(category.icon);

  return (
    <div
      className={cn(
        "flex min-h-12 items-center gap-3 rounded-2xl border border-border bg-card/40 px-3 py-2",
        !isTopLevel && "ml-9 border-dashed",
      )}
    >
      {hasChildren && onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={expanded ? "Contraer" : "Expandir"}
          aria-expanded={expanded}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-transform hover:bg-muted"
        >
          <CaretRight
            className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")}
          />
        </button>
      ) : (
        <span aria-hidden className="h-8 w-8 shrink-0" />
      )}

      <span
        aria-hidden
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
        style={{
          backgroundColor: `${category.color}20`,
          color: category.color,
        }}
      >
        <Icon weight="fill" className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-none">{category.name}</p>
        {category.is_system ? (
          <Badge
            variant="outline"
            className="mt-1 h-4 px-1.5 py-0 text-[10px] font-normal"
          >
            {t.category.system}
          </Badge>
        ) : null}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0"
              aria-label="Acciones"
            />
          }
        >
          <DotsThreeVertical weight="bold" className="h-5 w-5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit}>{t.actions.edit}</DropdownMenuItem>
          {isTopLevel && onAddSub ? (
            <DropdownMenuItem onClick={onAddSub}>
              {t.actions.add} subcategoría
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            {t.actions.delete}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
