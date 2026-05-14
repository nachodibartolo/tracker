import type { Metadata } from "next";

import { CategoryTree } from "@/components/categories/category-tree";
import { NewCategoryButton } from "@/components/categories/new-category-button";
import type { CategoryFormParentOption } from "@/components/categories/category-form";
import { MobileHeader } from "@/components/shared/mobile-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getCategoriesGrouped,
  type GroupedCategories,
} from "@/lib/domain/categories";
import type { CategoryType } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/i18n";

export const metadata: Metadata = {
  title: t.nav.categories,
};

export default async function CategoriesPage() {
  const grouped = await loadCategories();

  const expenseParents = toParentOptions(grouped.expense, "expense");
  const incomeParents = toParentOptions(grouped.income, "income");
  // Combined set lets the form filter on its own when the user flips tabs.
  const allParents = [...expenseParents, ...incomeParents];

  return (
    <>
      <MobileHeader title={t.nav.categories} />
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <div className="mb-4 hidden items-center justify-between md:mb-6 md:flex">
          <h1 className="font-heading text-3xl font-semibold">
            {t.nav.categories}
          </h1>
          <NewCategoryButton defaultType="expense" parentOptions={allParents} />
        </div>

        <Tabs defaultValue="expense" className="w-full">
          <div className="sticky top-12 z-10 -mx-4 mb-4 bg-background/95 px-4 pb-2 pt-2 backdrop-blur supports-[backdrop-filter]:bg-background/75 md:static md:top-auto md:mx-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
            <TabsList className="w-full md:w-fit">
              <TabsTrigger value="expense" className="flex-1 md:flex-none">
                {t.category.expense}
              </TabsTrigger>
              <TabsTrigger value="income" className="flex-1 md:flex-none">
                {t.category.income}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="expense" className="space-y-4">
            <div className="flex justify-end md:hidden">
              <NewCategoryButton
                defaultType="expense"
                parentOptions={allParents}
                size="sm"
                label={t.category.new}
              />
            </div>
            <CategoryTree
              type="expense"
              categories={grouped.expense}
              parentOptions={expenseParents}
            />
          </TabsContent>

          <TabsContent value="income" className="space-y-4">
            <div className="flex justify-end md:hidden">
              <NewCategoryButton
                defaultType="income"
                parentOptions={allParents}
                size="sm"
                label={t.category.new}
              />
            </div>
            <CategoryTree
              type="income"
              categories={grouped.income}
              parentOptions={incomeParents}
            />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

async function loadCategories(): Promise<GroupedCategories> {
  // Pre-provisioning safe path: when Supabase env vars are missing, fall back
  // to an empty grouped result so the page renders without crashing during
  // Wave 0–5 dev. Mirrors the auth guard in `app/(app)/layout.tsx`.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return { expense: [], income: [] };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { expense: [], income: [] };
    }
    return await getCategoriesGrouped(supabase, user.id);
  } catch {
    return { expense: [], income: [] };
  }
}

function toParentOptions(
  rows: GroupedCategories[CategoryType],
  type: CategoryType,
): CategoryFormParentOption[] {
  // Top-level only — sub-cats can't parent another category (max 2 levels).
  return rows.map((c) => ({ id: c.id, name: c.name, type }));
}
