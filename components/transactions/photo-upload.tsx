"use client";

import * as React from "react";
import { Camera, CircleNotch, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";

import {
  deleteReceiptPhoto,
  getReceiptSignedUrl,
  uploadReceiptPhoto,
} from "@/actions/storage";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface PhotoUploadProps {
  /** The storage path currently saved on the form. */
  value: string | null;
  onPhotoChange: (path: string | null) => void;
  className?: string;
  /** When true, deleting clears the form value but does NOT remove the object
   *  from storage (useful when the parent commits the deletion on submit). */
  deferRemoteDelete?: boolean;
}

/** Compress to a max edge of 1280px @ JPEG quality 0.75. */
const MAX_DIM = 1280;
const JPEG_QUALITY = 0.75;

/**
 * Mobile-first receipt photo input.
 *
 * Flow:
 * 1. The user taps "Tomar foto" — `accept="image/*" capture="environment"`
 *    opens the rear camera on iOS/Android.
 * 2. We compress the image via canvas (max edge 1280, JPEG q=0.75) so we don't
 *    push 8-12 MB iPhone photos through a serverless action.
 * 3. The compressed Blob is sent as FormData to `uploadReceiptPhoto` (server
 *    action) which returns the storage path; we forward it to the parent.
 * 4. When a path is set, we fetch a 5-min signed URL to render a thumbnail.
 *
 * Doc choice for receipts: target output is `image/jpeg` even when the input
 * is PNG/HEIC, because JPEG yields the smallest file for photo-of-paper
 * content and the bucket policy already whitelists it.
 */
export function PhotoUpload({
  value,
  onPhotoChange,
  className,
  deferRemoteDelete = false,
}: PhotoUploadProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);

  // Whenever `value` (the storage path) changes, fetch a fresh signed URL.
  // We don't cache across paths because signed URLs are tied to a specific
  // object key.
  React.useEffect(() => {
    let cancelled = false;
    if (!value) {
      setPreviewUrl(null);
      return;
    }
    (async () => {
      const result = await getReceiptSignedUrl(value);
      if (cancelled) return;
      if (result.ok && result.data) {
        setPreviewUrl(result.data.url);
      } else {
        setPreviewUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [value]);

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Elegí una imagen");
      return;
    }
    setBusy(true);
    try {
      const blob = await compressImage(file);
      const fd = new FormData();
      // Server action validates mime + size again.
      fd.append("file", new File([blob], "receipt.jpg", { type: "image/jpeg" }));
      const result = await uploadReceiptPhoto(fd);
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "No se pudo subir la foto" : result.error);
        return;
      }
      onPhotoChange(result.data.path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo procesar";
      toast.error(msg);
    } finally {
      setBusy(false);
      // Reset the file input so re-selecting the same file fires onChange.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleRemove() {
    if (!value) return;
    const path = value;
    onPhotoChange(null);
    if (!deferRemoteDelete) {
      // Best-effort cleanup. If it fails the user can retry later from the
      // detail page — we don't surface the error here because the form state
      // is already clean.
      void deleteReceiptPhoto(path);
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />

      {value && previewUrl ? (
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card/30 p-2">
          <div className="relative h-16 w-16 overflow-hidden rounded-xl bg-muted">
            {/* Signed URL is opaque (no domain whitelisting needed) so we use
                a plain <img> rather than next/image to avoid loader config. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Foto del recibo"
              className="h-full w-full object-cover"
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="truncate text-xs text-muted-foreground">
              {t.transaction.photo}
            </p>
            <p className="truncate text-xs font-mono text-muted-foreground/70">
              {value.split("/").pop()}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={handleRemove}
            aria-label={t.transaction.deletePhoto}
            disabled={busy}
          >
            <Trash />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="h-14 w-full justify-center gap-2 text-sm"
        >
          {busy ? (
            <>
              <CircleNotch weight="bold" className="size-4 animate-spin" />
              <span>Subiendo…</span>
            </>
          ) : (
            <>
              <Camera weight="bold" className="size-5" />
              <span>{t.transaction.takePhoto}</span>
            </>
          )}
        </Button>
      )}
    </div>
  );
}

/**
 * Compress an image client-side using a canvas. Always emits a JPEG so the
 * server-side mime whitelist (jpeg|png|webp) is satisfied, and so the user
 * never has to wait for a 10 MB HEIC to upload from a phone camera.
 */
async function compressImage(file: File): Promise<Blob> {
  const bitmap = await loadBitmap(file);
  const ratio = Math.min(MAX_DIM / bitmap.width, MAX_DIM / bitmap.height, 1);
  const width = Math.round(bitmap.width * ratio);
  const height = Math.round(bitmap.height * ratio);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Tu navegador no soporta compresión de imágenes");
  ctx.drawImage(bitmap, 0, 0, width, height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("No se pudo comprimir la imagen"));
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}

async function loadBitmap(
  file: File,
): Promise<HTMLImageElement | ImageBitmap> {
  // Prefer createImageBitmap when available — it decodes off the main thread.
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // fall through to <img>
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la imagen"));
    };
    img.src = url;
  });
}
