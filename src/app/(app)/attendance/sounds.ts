/**
 * Three distinct cues, synthesised with Web Audio — no asset files to download
 * on a terminal that may be on a slow connection.
 *
 * Browsers refuse to start an AudioContext without a user gesture, so it is
 * created lazily on the first tap/scan and resumed if the browser suspended it.
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
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Call from a click/scan handler so the context is unlocked before it's needed. */
export function primeAudio(): void {
  audio();
}

type Blip = { freq: number; start: number; duration: number; type?: OscillatorType };

function play(blips: Blip[], gainPeak = 0.18) {
  const ac = audio();
  if (!ac) return;

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
