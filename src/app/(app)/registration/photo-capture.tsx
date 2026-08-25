"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ImageUp, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/** Longest edge sent to the server. Cloudinary shrinks again to 400px. */
const MAX_EDGE = 900;
const JPEG_QUALITY = 0.85;

/**
 * Re-encodes the picked image to a modest JPEG before it ever hits the network.
 * A phone camera file is several MB, which would push a server action past its
 * body limit and waste the terminal's bandwidth for pixels Cloudinary discards.
 */
async function downscale(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) return file;

  return new File([blob], "photo.jpg", { type: "image/jpeg" });
}

/**
 * The `photo` form field. The visible inputs are throwaway pickers; whatever
 * they produce is downscaled and written into the hidden input that actually
 * submits, so the form still posts a real File with no JS glue at submit time.
 */
export function PhotoCapture({
  label = "Photo (optional)",
  currentUrl,
}: {
  label?: string;
  currentUrl?: string | null;
}) {
  const fieldRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  async function accept(file: File | undefined) {
    if (!file || !fieldRef.current) return;
    setWorking(true);
    try {
      const small = await downscale(file);
      const dt = new DataTransfer();
      dt.items.add(small);
      fieldRef.current.files = dt.files;

      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(small);
      });
    } finally {
      setWorking(false);
    }
  }

  function clear() {
    if (fieldRef.current) fieldRef.current.value = "";
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
  }

  const shown = preview ?? currentUrl ?? null;

  return (
    <div className="space-y-2">
      <Label>{label}</Label>

      <div className="flex items-start gap-4">
        <div className="bg-muted relative size-24 shrink-0 overflow-hidden rounded-lg border">
          {shown ? (
            // Cloudinary hosts are not configured for next/image optimisation,
            // and blob: previews can't be optimised at all.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt="Student photo" className="size-full object-cover" />
          ) : (
            <div className="text-muted-foreground grid size-full place-items-center">
              <Camera className="size-6" aria-hidden />
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" asChild>
              <label className="cursor-pointer">
                <Camera className="size-4" aria-hidden />
                Take photo
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={(e) => accept(e.target.files?.[0])}
                />
              </label>
            </Button>

            <Button type="button" variant="outline" size="sm" asChild>
              <label className="cursor-pointer">
                <ImageUp className="size-4" aria-hidden />
                Choose file
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => accept(e.target.files?.[0])}
                />
              </label>
            </Button>

            {preview && (
              <Button type="button" variant="ghost" size="sm" onClick={clear}>
                <X className="size-4" aria-hidden />
                Remove
              </Button>
            )}
          </div>

          <p className="text-muted-foreground text-xs">
            {working
              ? "Preparing image…"
              : "Optional — can be added later. Stored at 400px."}
          </p>
        </div>
      </div>

      {/* The field that actually submits. */}
      <input ref={fieldRef} type="file" name="photo" accept="image/*" className="hidden" />
    </div>
  );
}
