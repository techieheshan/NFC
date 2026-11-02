/**
 * A hard time limit for one step of the PDF. html2canvas draws from a cloned page and waits for that page to finish loading;
 * if something the clone needs (a font file) never answers, it never starts and never fails — the button would say "Preparing…"
 * for ever. A DeadlineError ends that wait like any other failure.
 *
 * The work behind the promise is NOT stopped (a browser promise cannot be cancelled): the caller must make a late result
 * harmless (see capture-plan.ts and clone-cleanup.ts).
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

/** Loading html2canvas and jsPDF (two chunks fetched on first use). On a flaky connection this can stall; it must still end. */
export const IMPORT_DEADLINE_MS = 20_000;

/**
 * ONE sheet drawn at ONE scale: scale 2, then 1.5, then 1 for the same sheet if it fails or stalls (capture-plan.ts). Each rung has
 * its own deadline, and the ladder is shared by the whole PDF, so there are at most three failed attempts: the SUM of these (75 s)
 * bounds the FAILED attempts only, whatever the number of sheets. Sheets that finish before a hang add their own time (up to 25 s
 * each), and the page-font check before the first sheet can take about 10 s. A slow device that finishes every sheet inside its
 * deadline is never cut off. What was measured, and why a sheet's deadline rather than the whole document's, is in AGENTS.md.
 */
export const ATTEMPT_DEADLINES_MS = [25_000, 25_000, 25_000] as const;
