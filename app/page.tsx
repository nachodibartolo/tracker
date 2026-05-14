import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export default async function RootPage() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    redirect(user ? "/dashboard" : "/login");
  }
  redirect("/dashboard");
}
