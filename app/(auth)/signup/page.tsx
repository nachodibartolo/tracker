import type { Metadata } from "next";
import Link from "next/link";

import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Crear cuenta",
};

export default function SignupPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="font-heading text-2xl font-semibold">Crear cuenta</h1>
        <p className="text-sm text-muted-foreground">
          Empezá a trackear tus gastos en minutos.
        </p>
      </div>
      <SignupForm />
      <p className="text-center text-sm text-muted-foreground">
        ¿Ya tenés cuenta?{" "}
        <Link className="font-medium text-foreground underline" href="/login">
          Iniciar sesión
        </Link>
      </p>
    </div>
  );
}
