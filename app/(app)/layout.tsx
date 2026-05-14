import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/shared/app-sidebar";
import { BottomNav } from "@/components/shared/bottom-nav";
import { CommandPalette } from "@/components/shared/command-palette";
import { NewTransactionTrigger } from "@/components/shared/new-transaction-trigger";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let userEmail: string | null = null;

  // Pre-provisioning safe path: the middleware lets us through when Supabase is
  // not configured yet (Wave 0-5 dev). Real auth enforcement lives in middleware.
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      redirect("/login");
    }
    userEmail = user.email ?? null;
  }

  return (
    <SidebarProvider>
      <AppSidebar userEmail={userEmail} />
      <SidebarInset>
        <header className="sticky top-0 z-10 hidden h-14 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur md:flex">
          <SidebarTrigger className="-ml-1" />
        </header>
        <main className="flex-1 pb-24 md:pb-6">{children}</main>
      </SidebarInset>
      <BottomNav userEmail={userEmail} />
      <NewTransactionTrigger />
      <CommandPalette />
    </SidebarProvider>
  );
}
