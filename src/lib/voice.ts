"use client";

/**
 * Spoken confirmations, layered ON TOP of the tones — never instead of them.
 *
 * A tone tells staff that something happened; at a counter running by ear, the
 * voice tells them WHAT happened without looking up. The tone is faster and
 * always plays first, so nothing here is on the critical path: speech is fired
 * after the action has already completed, and every call is best-effort.
 *
 * `speechSynthesis` is built into the browser — no audio files, no network — so
 * this works during an outage exactly as it does online.
 */

let enabled = true;
/** The speak scheduled by the most recent `say`, so a newer phrase cancels it. */
let pending: number | null = null;

/** Set once from the Settings toggle when the screen mounts. */
export function setVoiceEnabled(on: boolean): void {
  enabled = on;
}

function available(): boolean {
  return (
    enabled &&
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
}

/**
 * Speak a short English phrase. Silently does nothing when speech is off or
 * unavailable — a device without a voice must still take attendance, so this
 * never throws and never blocks a flow waiting for it.
 */
export function say(phrase: string): void {
  if (!available()) return;
  try {
    const synth = window.speechSynthesis;

    // Drop anything still speaking OR already queued behind it: at a fast
    // counter the previous student's phrase is stale by the time the next card
    // lands, and a queued one would arrive late over the top of the new one.
    if (pending !== null) window.clearTimeout(pending);
    synth.cancel();

    const speak = () => {
      pending = null;
      const utter = new SpeechSynthesisUtterance(phrase);
      utter.lang = "en-US";
      utter.rate = 1.15; // Brisk — these are two-word phrases over a noisy queue.
      utter.volume = 1;
      // A synth left paused (a backgrounded tab, a previous cancel) accepts the
      // utterance and never speaks it, which is what "sometimes silent" was.
      if (synth.paused) synth.resume();
      synth.speak(utter);
    };

    // Chrome drops an utterance spoken in the same task as `cancel()` when
    // something was mid-phrase, so the new one goes out on the next tick —
    // immediately in human terms, and reliably.
    pending = window.setTimeout(speak, 0);
  } catch {
    // A device that refuses to speak still marks attendance.
  }
}

/** The phrases, in one place so they stay short and consistent. */
export const VOICE = {
  marked: () => say("Marked."),
  markedOwing: () => say("Marked. Payment due."),
  alreadyMarked: () => say("Already marked."),
  unknownCard: () => say("Unknown card."),
  noClass: () => say("No class now."),
  paymentComplete: () => say("Payment complete. Thank you."),
  registered: () => say("Student registered."),
} as const;
