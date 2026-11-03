import { withDeadline } from "./deadline";
import { SheetFontsError } from "./sheet-fonts";

/** Scale 2 keeps text crisp; a sheet that cannot be drawn at 2 is tried at 1.5 and then 1. */
export const SCALES = [2, 1.5, 1] as const;

export type CapturePlan<I> = {
  /** Number of sheets. */
  count: number;
  /** The ladder: scale 2, then 1.5, then 1. */
  scales: readonly number[];
  /** One deadline per rung (same length as `scales`): how long ONE sheet may take at that scale. */
  deadlinesMs: readonly number[];
  /** Draw sheet `index` at `scale`. `isLive()` turns false once this attempt was given up on: do nothing more with a late result. */
  capture(index: number, scale: number, isLive: () => boolean): Promise<I>;
  /** Called once with every sheet's image, in order, when all are drawn (builds and saves the PDF). */
  finish(images: I[]): void | Promise<void>;
  /** Called after every failed or abandoned attempt (removes what the library left on the page). */
  cleanup(): void;
  /** Called as each attempt on a sheet starts: page 1..count. */
  onProgress?(page: number, total: number): void;
};

/**
 * Draws every sheet. Each ATTEMPT (one sheet at one scale) has its own deadline; the deadline measures one sheet, not the whole
 * document, so a slow device that keeps making progress is never cut off and a stall is noticed within one deadline.
 *
 * - An attempt that fails or runs out of time is repeated for the SAME sheet at the next lower scale, with that rung's deadline.
 * - The ladder is shared by the whole PDF: once it has stepped down, the later sheets start at the lower scale. So there are at most
 *   `scales.length` failed attempts in total, and a capture that hangs ends within the SUM of the deadlines, however many sheets.
 * - A `SheetFontsError` is never retried (a smaller picture does not make a font appear): it ends everything at once.
 * - An attempt that ran out of time is abandoned, not stopped (a browser promise cannot be cancelled): it is marked dead
 *   (`isLive()` is false), so its late result is dropped and cannot draw anything, report progress or reach `finish`.
 * - When the last rung fails, that failure is thrown.
 */
export async function runCaptures<I>(plan: CapturePlan<I>): Promise<void> {
  const images: I[] = [];
  let rung = 0;
  for (let i = 0; i < plan.count; i++) {
    for (;;) {
      let live = true;
      plan.onProgress?.(i + 1, plan.count);
      try {
        const image = await withDeadline(plan.capture(i, plan.scales[rung], () => live), plan.deadlinesMs[rung]);
        images.push(image);
        break;
      } catch (e) {
        live = false;
        plan.cleanup();
        if (e instanceof SheetFontsError) throw e;
        rung++;
        if (rung >= plan.scales.length) throw e instanceof Error ? e : new Error("pdf failed");
      }
    }
  }
  await plan.finish(images);
}
