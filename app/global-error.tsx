"use client";

import * as React from "react";

/**
 * Top-level boundary that catches crashes inside the root `<html>`/`<body>`
 * tree (provider failures, font loaders, etc.). Replaces the entire document
 * so it must render its own `<html>` + `<body>` and cannot rely on the app's
 * providers (no Toaster, no theme — keep it dependency-free).
 *
 * Per Next.js docs: only rendered in production builds.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("[global] route error", error);
  }, [error]);

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
          background: "#0a0a0a",
          color: "#fafafa",
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h1
            style={{
              fontSize: "1.5rem",
              fontWeight: 600,
              margin: 0,
              marginBottom: "0.5rem",
            }}
          >
            Algo salió mal
          </h1>
          <p
            style={{
              fontSize: "0.875rem",
              opacity: 0.7,
              margin: 0,
              marginBottom: "1.5rem",
            }}
          >
            {error.message ||
              "La aplicación crasheó inesperadamente. Probá de recargar."}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              appearance: "none",
              border: 0,
              borderRadius: 999,
              padding: "0.625rem 1.25rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              background: "#fafafa",
              color: "#0a0a0a",
              cursor: "pointer",
            }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
