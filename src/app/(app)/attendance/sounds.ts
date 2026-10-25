/**
 * Three distinct cues, synthesised with Web Audio — no asset files to download
 * on a terminal that may be on a slow connection.
 *
 * Two rules the counter depends on, both learned the hard way:
 *
 * 1. A browser starts an AudioContext `suspended` unless it is created during
 *    a real user gesture, and `resume()` outside one is ignored. An NFC
 *    `reading` event is NOT a user gesture, so a screen that arms the reader on
 *    entry and never gets a touch can tap cards all day in silence. That is why
 *    `primeAudio` is wired to a listener on the DOCUMENT — the first thing
 *    staff touch is often the menu or the header, not this screen's own box.
 *
 * 2. A suspended context's `currentTime` is FROZEN. Scheduling at
 *    `currentTime + offset` while suspended puts every blip in the past, and
 *    they all fire at once the moment it resumes — one burst of noise for a
 *    queue of students. So `play` never schedules against a frozen clock: it
 *    resumes first and reads the clock again afterwards.
 */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Call from a real user gesture — a touch, a click — so the context is unlocked
 * before the first card lands. Safe to call on every tap: creating the context
 * is once-only and `resume()` on a running context is a no-op.
 */
export function primeAudio(): void {
  const ac = audio();
  if (ac && ac.state !== "running") void ac.resume().catch(() => {});
}

type Blip = { freq: number; start: number; duration: number; type?: OscillatorType };

function play(blips: Blip[], gainPeak = 0.18) {
  const ac = audio();
  if (!ac) return;

  if (ac.state !== "running") {
    // Resume FIRST, then schedule against the clock as it is once it is
    // running. Without this the offsets are measured from a stopped clock.
    void ac
      .resume()
      .then(() => schedule(ac, blips, gainPeak))
      .catch(() => {});
    return;
  }

  schedule(ac, blips, gainPeak);
}

function schedule(ac: AudioContext, blips: Blip[], gainPeak: number) {
  for (const b of blips) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = b.type ?? "sine";
    osc.frequency.value = b.freq;

    const t0 = ac.currentTime + b.start;
    // Ramped rather than switched, so it doesn't click on cheap speakers.
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(gainPeak, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + b.duration);

    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + b.duration + 0.02);
  }
}

/** Fresh mark — short rising two-tone, unmistakably "done". */
export const playSuccess = () =>
  play([
    { freq: 880, start: 0, duration: 0.09 },
    { freq: 1320, start: 0.09, duration: 0.14 },
  ]);

/** Already marked — flat double blip at one pitch, clearly not the success cue. */
export const playAlreadyMarked = () =>
  play([
    { freq: 660, start: 0, duration: 0.08 },
    { freq: 660, start: 0.14, duration: 0.08 },
  ]);

/** Rejected — low buzz, obviously wrong even in a noisy corridor. */
export const playReject = () =>
  play([{ freq: 160, start: 0, duration: 0.32, type: "sawtooth" }], 0.12);

/**
 * Marked, but the student owes — success followed by a low tail, so staff hear
 * "yes, and look up" without stopping the queue. Deliberately starts like
 * `playSuccess` so a busy counter still hears the mark land.
 */
export const playMarkedButOwes = () =>
  play([
    { freq: 880, start: 0, duration: 0.09 },
    { freq: 1320, start: 0.09, duration: 0.1 },
    { freq: 440, start: 0.24, duration: 0.22, type: "triangle" },
  ]);

/** Needs a choice — insistent triple, the only cue that means "stop and click". */
export const playNeedsChoice = () =>
  play([
    { freq: 1046, start: 0, duration: 0.07 },
    { freq: 1046, start: 0.12, duration: 0.07 },
    { freq: 1046, start: 0.24, duration: 0.07 },
  ]);

/** Payment taken — a longer rising chime, distinct from a plain mark. */
export const playPaymentSuccess = () =>
  play([
    { freq: 660, start: 0, duration: 0.1 },
    { freq: 880, start: 0.1, duration: 0.1 },
    { freq: 1320, start: 0.2, duration: 0.26 },
  ]);
