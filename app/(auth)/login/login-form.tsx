"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { signIn, signInWithMagicLink } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export function LoginForm() {
  const [pending, startTransition] = useTransition();
  const [magicPending, startMagicTransition] = useTransition();
  const [email, setEmail] = useState("");

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await signIn(formData);
      if (result && !result.ok) {
        toast.error(result.error);
      }
    });
  }

  function handleMagicLink() {
    if (!email) {
      toast.error("Necesitamos tu email primero");
      return;
    }
    startMagicTransition(async () => {
      const fd = new FormData();
      fd.set("email", email);
      const result = await signInWithMagicLink(fd);
      if (result.ok) {
        toast.success("Revisá tu casilla, te mandamos el link");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <form action={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@email.com"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Contraseña</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            placeholder="Mínimo 8 caracteres"
          />
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Ingresando…" : "Iniciar sesión"}
        </Button>
      </form>
      <div className="flex items-center gap-2">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">o</span>
        <Separator className="flex-1" />
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={magicPending}
        onClick={handleMagicLink}
      >
        {magicPending ? "Enviando…" : "Recibir magic link"}
      </Button>
    </div>
  );
}
