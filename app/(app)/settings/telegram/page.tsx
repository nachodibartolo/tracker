"use client";

// Telegram linking UI: generate a 6-digit code, render a big copyable block
// with a 10-minute countdown, and offer a `t.me/<bot>?start=<code>` deep-link
// when the bot username is exposed via `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`.
//
// The page also includes the `RevokeTelegramButton` so users who are already
// linked can disconnect from this same screen.

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";

import { Check, Copy, TelegramLogo } from "@phosphor-icons/react";

import { generateLinkCode } from "@/actions/telegram";
import { MobileHeader } from "@/components/shared/mobile-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { t } from "@/lib/i18n";

import { RevokeTelegramButton } from "./revoke-button";

interface ActiveCode {
  code: string;
  expiresAt: number; // ms timestamp
}

function formatCountdown(msRemaining: number): string {
  const clamped = Math.max(0, msRemaining);
  const totalSec = Math.floor(clamped / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function TelegramSettingsPage() {
  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;

  const [pending, startTransition] = useTransition();
  const [active, setActive] = useState<ActiveCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Re-render the countdown every second while a code is active.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  // Auto-clear an expired code so the UI doesn't lie about it being usable.
  useEffect(() => {
    if (!active) return;
    if (now >= active.expiresAt) {
      setActive(null);
    }
  }, [active, now]);

  const handleGenerate = useCallback(() => {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const res = await generateLinkCode();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const data = res.data;
      if (!data) {
        setError("Respuesta vacía del servidor");
        return;
      }
      setActive({
        code: data.code,
        expiresAt: new Date(data.expiresAt).getTime(),
      });
    });
  }, []);

  const handleCopy = useCallback(async () => {
    if (!active) return;
    try {
      await navigator.clipboard.writeText(active.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("No se pudo copiar al portapapeles");
    }
  }, [active]);

  const remaining = active ? active.expiresAt - now : 0;
  const expired = active && remaining <= 0;
  const deepLink =
    active && botUsername ? `https://t.me/${botUsername}?start=${active.code}` : null;

  return (
    <>
      <MobileHeader title={t.settings.telegram} />
      <div className="container mx-auto max-w-2xl px-4 py-4 md:py-6">
        <div className="mb-4 hidden md:mb-6 md:block">
          <h1 className="font-heading text-3xl font-semibold">
            {t.settings.telegram}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Vinculá la app con tu cuenta de Telegram para registrar gastos
            sobre la marcha.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t.settings.telegramConnect}</CardTitle>
            <CardDescription>
              Generá un código de un solo uso (vale 10 minutos) y mandáselo al
              bot.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!active || expired ? (
              <Button
                type="button"
                onClick={handleGenerate}
                disabled={pending}
                className="w-full md:w-auto"
              >
                <TelegramLogo className="h-4 w-4" />
                <span>
                  {pending
                    ? "Generando…"
                    : t.settings.telegramGenerateCode}
                </span>
              </Button>
            ) : (
              <div className="space-y-3 rounded-2xl border border-border bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-3">
                  <code className="font-mono text-3xl font-bold tracking-[0.4em] tabular-nums md:text-4xl">
                    {active.code}
                  </code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={handleCopy}
                    aria-label="Copiar código"
                  >
                    {copied ? (
                      <Check className="h-5 w-5" />
                    ) : (
                      <Copy className="h-5 w-5" />
                    )}
                  </Button>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {t.settings.telegramInstructions}
                  </p>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {formatCountdown(remaining)}
                  </span>
                </div>
                {deepLink ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full md:w-auto"
                    render={
                      <Link
                        href={deepLink}
                        target="_blank"
                        rel="noreferrer"
                      />
                    }
                  >
                    <TelegramLogo className="h-4 w-4" />
                    <span>Abrir en Telegram</span>
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Mandale <code>/start {active.code}</code> al bot de Tracker.
                  </p>
                )}
              </div>
            )}

            {error ? (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>{t.settings.telegramDisconnect}</CardTitle>
            <CardDescription>
              Si querés dejar de usar el bot, podés desvincular la cuenta acá.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RevokeTelegramButton />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
