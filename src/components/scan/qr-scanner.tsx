"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Native Barcode Detection API — Chrome/Android and some desktop Chrome. Not in
 * lib.dom, so only the surface used is declared.
 */
type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

/**
 * Reads the card number from a card's QR.
 *
 * The QR holds the printed number as a plain string ("0186-0001-2000") — no URL,
 * no prefix — so the decoded value is passed straight through to the same
 * normaliser manual entry uses.
 *
 * Decoding prefers the native detector and falls back to jsQR, which is loaded
 * with a dynamic import so ~35KB of decoder never reaches devices that either
 * have the native API or never open the scanner. That matters here: this screen
 * also runs on the terminal.
 */
export function QrScanner({
  open,
  onOpenChange,
  onDecode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDecode: (value: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    if (!open) return;

    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelled = false;
    const canvas = document.createElement("canvas");

    const finish = (value: string) => {
      if (cancelled) return;
      cancelled = true;
      onDecode(value.trim());
      onOpenChange(false);
    };

    async function run() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) return;

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        if (!cancelled) setStarting(false);

        const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
          .BarcodeDetector;
        const detector = Ctor ? new Ctor({ formats: ["qr_code"] }) : null;
        // Only pulled in when the native detector is missing.
        const jsQR = detector ? null : (await import("jsqr")).default;

        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          const v = videoRef.current;

          if (v.readyState === v.HAVE_ENOUGH_DATA) {
            try {
              if (detector) {
                const found = await detector.detect(v);
                if (found.length > 0 && found[0].rawValue) {
                  finish(found[0].rawValue);
                  return;
                }
              } else if (jsQR) {
                canvas.width = v.videoWidth;
                canvas.height = v.videoHeight;
                const ctx = canvas.getContext("2d", { willReadFrequently: true });
                if (ctx && canvas.width && canvas.height) {
                  ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
                  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
                  const code = jsQR(data.data, data.width, data.height);
                  if (code?.data) {
                    finish(code.data);
                    return;
                  }
                }
              }
            } catch {
              // A single failed frame is normal; keep scanning.
            }
          }

          raf = requestAnimationFrame(() => void tick());
        };

        void tick();
      } catch (e) {
        if (cancelled) return;
        const name = (e as { name?: string })?.name;
        setStarting(false);
        setError(
          name === "NotAllowedError"
            ? "Camera permission denied. Allow it, or type the card number instead."
            : name === "NotFoundError"
              ? "No camera found on this device. Type the card number instead."
              : "Couldn't start the camera. Type the card number instead.",
        );
      }
    }

    void run();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, onDecode, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Scan card QR</DialogTitle>
          <DialogDescription>
            Point the camera at the QR printed on the card.
          </DialogDescription>
        </DialogHeader>

        <div className="bg-muted relative aspect-square w-full overflow-hidden rounded-lg">
          <video
            ref={videoRef}
            className="size-full object-cover"
            playsInline
            muted
            aria-label="Camera preview"
          />
          {starting && !error && (
            <div className="absolute inset-0 grid place-items-center">
              <Loader2 className="text-primary size-6 animate-spin" aria-hidden />
            </div>
          )}
          {!starting && !error && (
            <div className="pointer-events-none absolute inset-8 rounded-lg border-2 border-white/80" />
          )}
        </div>

        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}

        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      </DialogContent>
    </Dialog>
  );
}
