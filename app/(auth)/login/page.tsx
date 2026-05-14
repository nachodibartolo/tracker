import type { Metadata } from "next";
import Link from "next/link";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Iniciar sesión",
};

export default function LoginPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="font-heading text-2xl font-semibold">Iniciar sesión</h1>
        <p className="text-sm text-muted-foreground">
          Bienvenido de vuelta. Ingresá tus datos para continuar.
        </p>
      </div>
      <LoginForm />
      <p className="text-center text-sm text-muted-foreground">
        ¿No tenés cuenta?{" "}
        <Link className="font-medium text-foreground underline" href="/signup">
          Crear cuenta
        </Link>
      </p>
    </div>
  );
}
