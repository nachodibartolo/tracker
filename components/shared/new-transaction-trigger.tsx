"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { FAB } from "@/components/shared/fab";

/**
 * Wave-1 placeholder: clicking FAB navigates to /transactions/new.
 * Wave 3 replaces this with a `<ResponsiveModal>` opening the transaction form
 * in-place (bottom-sheet on mobile / dialog on desktop).
 */
export function NewTransactionTrigger() {
  const router = useRouter();
  return <FAB onClick={() => router.push("/transactions/new")} />;
}
