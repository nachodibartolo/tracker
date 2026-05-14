import type { Metadata } from "next";
import Link from "next/link";

import { MobileHeader } from "@/components/shared/mobile-header";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { t } from "@/lib/i18n";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { RevokeTelegramButton } from "./telegram/revoke-button";

export const metadata: Metadata = {
  title: t.settings.title,
};

interface SettingsData {
  mainCurrency: string;
  telegramUsername: string | null;
  isLinked: boolean;
}

async function loadSettings(): Promise<SettingsData> {
  const fallback: SettingsData = {
    mainCurrency: "ARS",
    telegramUsername: null,
    isLinked: false,
  };

  // Pre-provisioning safe path: render the page even without Supabase env.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return fallback;
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return fallback;

    const { data: profile } = await supabase
      .from("profiles")
      .select("main_currency")
      .eq("id", user.id)
      .maybeSingle();

    let telegramUsername: string | null = null;
    let isLinked = false;
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const admin = createAdminClient();
        const { data: tg } = await admin
          .from("telegram_users")
          .select("telegram_username")
          .eq("user_id", user.id)
          .maybeSingle();
        if (tg) {
          isLinked = true;
          telegramUsername = tg.telegram_username;
        }
      } catch {
        // No service-role key in this env — treat as unlinked.
      }
    }

    return {
      mainCurrency: profile?.main_currency ?? "ARS",
      telegramUsername,
      isLinked,
    };
  } catch {
    return fallback;
  }
}

export default async function SettingsPage() {
  const { mainCurrency, telegramUsername, isLinked } = await loadSettings();

  return (
    <>
      <MobileHeader title={t.settings.title} />
      <div className="container mx-auto max-w-3xl px-4 py-4 md:py-6">
        <div className="mb-4 hidden md:mb-6 md:block">
          <h1 className="font-heading text-3xl font-semibold">
            {t.settings.title}
          </h1>
        </div>

        <div className="space-y-4">
          {/* --- Perfil --- */}
          <Card>
            <CardHeader>
              <CardTitle>{t.settings.profile}</CardTitle>
              <CardDescription>
                Tu identidad y preferencias generales.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {t.settings.mainCurrency}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    La usamos para totalizar saldos.
                  </p>
                </div>
                <span className="font-mono text-sm font-semibold">
                  {mainCurrency}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* --- Telegram --- */}
          <Card>
            <CardHeader>
              <CardTitle>{t.settings.telegram}</CardTitle>
              <CardDescription>
                Registrá gastos por chat, foto o audio.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {isLinked ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm">
                    Vinculado como{" "}
                    <span className="font-mono font-semibold">
                      {telegramUsername ? `@${telegramUsername}` : "tu cuenta"}
                    </span>
                  </p>
                  <RevokeTelegramButton />
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    Todavía no tenés Telegram vinculado.
                  </p>
                  <Button
                    size="sm"
                    render={<Link href="/settings/telegram" />}
                  >
                    {t.settings.telegramConnect}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* --- Apariencia --- */}
          <Card>
            <CardHeader>
              <CardTitle>Apariencia</CardTitle>
              <CardDescription>{t.settings.theme}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Alternar entre claro y oscuro.
                </p>
                <ThemeToggle variant="outline" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
