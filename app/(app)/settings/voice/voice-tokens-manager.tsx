"use client";

// Voice-token management UI.
//
// On mount: lists existing tokens (label, last_used_at, revoke button).
// "Generate new token": opens a small form (label + wallet selector),
// then renders the plaintext token ONCE with a copy button.
//
// All mutations go through the server actions in `actions/voice-tokens`.

import { useEffect, useState, useTransition } from "react";

import { Check, Copy, Trash } from "@phosphor-icons/react";

import {
  createVoiceToken,
  listVoiceTokens,
  revokeVoiceToken,
  type VoiceTokenRow,
} from "@/actions/voice-tokens";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface Wallet {
  id: string;
  name: string;
}

interface Props {
  wallets: Wallet[];
}

export function VoiceTokensManager({ wallets }: Props) {
  const [tokens, setTokens] = useState<VoiceTokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [walletId, setWalletId] = useState<string | "">("");

  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = async () => {
    setLoading(true);
    const r = await listVoiceTokens();
    if (r.ok) setTokens(r.data ?? []);
    else setError(r.error);
    setLoading(false);
  };

  useEffect(() => {
    // Defer the state-updating fetch to the next microtask so this effect
    // body doesn't call setState synchronously (React lint rule).
    queueMicrotask(() => {
      void refresh();
    });
  }, []);

  const onCreate = () => {
    setError(null);
    startTransition(async () => {
      const r = await createVoiceToken({
        label: label.trim(),
        default_wallet_id: walletId === "" ? null : walletId,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setCreatedToken(r.data!.token);
      setShowForm(false);
      setLabel("");
      setWalletId("");
      void refresh();
    });
  };

  const onRevoke = (id: string) => {
    setError(null);
    startTransition(async () => {
      const r = await revokeVoiceToken(id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      void refresh();
    });
  };

  const onCopy = async () => {
    if (!createdToken) return;
    await navigator.clipboard.writeText(createdToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Tokens activos</CardTitle>
          <CardDescription>
            Cada token autoriza a un dispositivo (un iPhone, un iPad) a usar el Atajo de Siri.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <div className="text-sm text-muted-foreground">Cargando…</div>
          ) : tokens.filter((t) => t.revoked_at === null).length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No tenés tokens activos. Generá uno para configurar el Atajo.
            </div>
          ) : (
            tokens
              .filter((t) => t.revoked_at === null)
              .map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{t.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {t.last_used_at
                        ? `Último uso: ${new Date(t.last_used_at).toLocaleString()}`
                        : "Sin uso aún"}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onRevoke(t.id)}
                    disabled={pending}
                  >
                    <Trash className="size-4" />
                  </Button>
                </div>
              ))
          )}
        </CardContent>
      </Card>

      {createdToken ? (
        <Card>
          <CardHeader>
            <CardTitle>Token generado</CardTitle>
            <CardDescription>
              Copialo ahora — no se vuelve a mostrar. Pegalo en la acción
              &quot;Obtener contenido de URL&quot; del Atajo de iOS.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2 rounded-md border bg-muted p-3 font-mono text-sm break-all">
              {createdToken}
              <Button size="sm" variant="ghost" onClick={onCopy}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
            <Button variant="outline" size="sm" onClick={() => setCreatedToken(null)}>
              Listo, lo guardé
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {!showForm ? (
        <Button onClick={() => setShowForm(true)}>+ Generar nuevo token</Button>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Nuevo token</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Label</label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="iPhone personal"
                maxLength={60}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Wallet por defecto</label>
              <select
                className="w-full rounded-md border bg-background p-2 text-sm"
                value={walletId}
                onChange={(e) => setWalletId(e.target.value)}
              >
                <option value="">— Sin default —</option>
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <Button onClick={onCreate} disabled={pending || label.trim().length === 0}>
                Generar
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowForm(false);
                  setLabel("");
                  setWalletId("");
                  setError(null);
                }}
              >
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {error ? (
        <div className="text-sm text-destructive">{error}</div>
      ) : null}

      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Cómo configurar el Atajo de iOS
        </summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Abrí la app <strong>Atajos</strong> en el iPhone → <strong>+</strong>.</li>
          <li>
            Acción <strong>&quot;Pedir entrada&quot;</strong> — pregunta:{" "}
            <em>¿Qué gasto?</em> · tipo: <strong>Texto</strong>.
          </li>
          <li>
            Acción <strong>&quot;Obtener contenido de URL&quot;</strong>:
            <ul className="list-disc pl-5">
              <li>URL: <code>https://&lt;tu-dominio&gt;/api/voice/agent</code></li>
              <li>Método: <strong>POST</strong></li>
              <li>
                Encabezados:{" "}
                <code>Authorization: Bearer &lt;token&gt;</code> y{" "}
                <code>Content-Type: application/json</code>
              </li>
              <li>
                Cuerpo (JSON): clave <code>text</code> → valor{" "}
                <em>Texto proporcionado</em> (variable del paso 2).
              </li>
            </ul>
          </li>
          <li>
            Acción <strong>&quot;Obtener valor del diccionario&quot;</strong> →{" "}
            clave <code>text</code>.
          </li>
          <li>
            Acción <strong>&quot;Hablar texto&quot;</strong> con el resultado del paso anterior.
          </li>
          <li>Nombre del atajo: <strong>Agregar gasto</strong>.</li>
          <li>Decile a Siri: <em>&quot;Hey Siri, agregar gasto&quot;</em>.</li>
        </ol>
      </details>
    </div>
  );
}
