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
  options: { continuous?: boolean; autoStart?: boolean } = {},
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
  const { continuous = false, autoStart = false } = options;
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

  /**
   * Arm on arrival, where the browser allows it.
   *
   * Registration and Payment open with a card already in someone's hand, so
   * making staff press a button first is a step per student across thousands of
   * them. Chrome requires a user gesture for the FIRST `scan()` on an origin —
   * the permission prompt — so this attempt can fail; when it does, `start()`
   * sets `error` and the screen falls back to showing the button. Once the
   * permission is granted, arriving on the screen is enough.
   */
  const armed = useRef(false);
  useEffect(() => {
    if (!autoStart || armed.current || support !== "supported") return;
    armed.current = true;
    void start();
    // `start` is stable for this component's lifetime; re-arming on every
    // render would restart the reader mid-queue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, support]);

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
