/**
 * A hard time limit for one step of the PDF. html2canvas draws from a cloned page and waits for that page to finish loading;
 * if something the clone needs (a font file) never answers, it never starts and never fails — the button would say "Preparing…"
 * for ever. A DeadlineError ends that wait like any other failure: the PDF is not made and the message is shown.
 */
export class DeadlineError extends Error {
  constructor(readonly ms: number) {
    super(`gave up after ${ms} ms`);
    this.name = "DeadlineError";
  }
}

export function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new DeadlineError(ms)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/** One sheet's capture. Generous (a slow 32-bit terminal at scale 2 is slow) but finite. */
export const CAPTURE_DEADLINE_MS = 30_000;
