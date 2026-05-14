import { redirect } from "next/navigation";

import { MobileHeader } from "@/components/shared/mobile-header";
import { createClient } from "@/lib/supabase/server";

import { VoiceTokensManager } from "./voice-tokens-manager";

export default async function VoiceSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: wallets } = await supabase
    .from("wallets")
    .select("id, name")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  return (
    <>
      <MobileHeader title="Voz (Siri)" />
      <main className="container mx-auto max-w-2xl p-4">
        <VoiceTokensManager wallets={wallets ?? []} />
      </main>
    </>
  );
}
