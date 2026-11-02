import { PDF_FAIL_MESSAGE } from "./make-pdf";

/**
 * Runs the PDF step and turns ANY failure into the one sentence staff see: null when the PDF was made, PDF_FAIL_MESSAGE when it
 * was not (a missing font, a deadline, a canvas the device could not allocate, anything). The view shows what this returns.
 */
export async function downloadPdf(make: () => Promise<void>): Promise<string | null> {
  try {
    await make();
    return null;
  } catch {
    return PDF_FAIL_MESSAGE;
  }
}
