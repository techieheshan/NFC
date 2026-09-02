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
    // Drop anything still speaking: at a fast counter the previous student's
    // phrase is already stale by the time the next card lands.
    window.speechSynthesis.cancel();

    const utter = new SpeechSynthesisUtterance(phrase);
    utter.lang = "en-US";
    utter.rate = 1.15; // Brisk — these are two-word phrases over a noisy queue.
    utter.volume = 1;
    window.speechSynthesis.speak(utter);
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
