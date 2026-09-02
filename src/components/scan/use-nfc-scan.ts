"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Minimal Web NFC typings — `NDEFReader` is Chrome/Android only and isn't in
 * lib.dom, so only the surface we use is declared.
 */
type NDEFReadingEvent = Event & { serialNumber?: string };
type NDEFReaderLike = {
  scan: (options?: { signal?: AbortSignal }) => Promise<void>;
  onreading: ((event: NDEFReadingEvent) => void) | null;
  onreadingerror: (() => void) | null;
};
type NDEFReaderCtor = new () => NDEFReaderLike;

/**
 * Availability is browser state, so it's read through `useSyncExternalStore`
 * rather than an effect. The server snapshot is "unknown", which is what the
 * hydration pass renders — identical markup on both sides, and no flash of
 * "NFC missing" on a phone that has it.
 */
export type NfcSupport = "unknown" | "supported" | "unsupported";

const subscribeToNothing = () => () => {};
const readSupport = (): NfcSupport =>
  "NDEFReader" in window ? "supported" : "unsupported";
const supportOnServer = (): NfcSupport => "unknown";

/**
 * The card-tap reader, shared by Registration and Attendance so both behave
 * identically — one permission flow, one set of error messages, one abort path.
 */
export function useNfcScan(
  onUid: (uid: string) => void,
  options: { continuous?: boolean } = {},
) {
  /**
   * One-shot (registration: identify one card, then get on with the form) or
   * continuous (the attendance counter: armed once, then a queue of students
   * taps one after another with no further button press).
   *
   * This used to abort unconditionally after the first reading, which meant a
   * real reader stopped dead after one student — invisible in testing, because
   * a stubbed NDEFReader ignores the abort signal and keeps firing.
   */
  const { continuous = false } = options;
  const support = useSyncExternalStore(subscribeToNothing, readSupport, supportOnServer);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /**
   * The scan loop outlives many renders, so its handler reads the callback
   * through a ref — capturing it once would keep calling the first render's
   * closure for every student in the queue.
   */
  const onUidRef = useRef(onUid);
  useEffect(() => {
    onUidRef.current = onUid;
  }, [onUid]);

  // Stop an in-flight scan if the screen goes away mid-read.
  useEffect(() => () => abortRef.current?.abort(), []);

  async function start() {
    setError(null);

    const Ctor = (window as unknown as { NDEFReader?: NDEFReaderCtor }).NDEFReader;
    if (!Ctor) return;

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      const reader = new Ctor();
      reader.onreading = (event) => {
        const uid = event.serialNumber;
        if (!uid) return;
        if (!continuous) {
          controller.abort();
          setScanning(false);
        }
        onUidRef.current(uid);
      };
      reader.onreadingerror = () => setError("Couldn't read that card. Try again.");

      await reader.scan({ signal: controller.signal });
      setScanning(true);
    } catch (e) {
      setScanning(false);
      const name = (e as { name?: string })?.name;
      setError(
        name === "NotAllowedError"
          ? "NFC permission was denied. Allow it in the browser, or use QR / search."
          : "Couldn't start the NFC scan. Use QR or search instead.",
      );
    }
  }

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setScanning(false);
  }

  return { support, scanning, error, start, stop, setError };
}
