import { BusyError } from "./exclusive";
import { PDF_FAIL_MESSAGE } from "./make-pdf";

export const PDF_BUSY_MESSAGE = "A PDF is already being made. Wait for it to finish.";

/**
 * Runs the PDF step and turns ANY failure into the one sentence staff see: null when the PDF was made, PDF_FAIL_MESSAGE when it
 * was not (a missing font, a deadline, a canvas the device could not allocate, anything). The only other sentence is the one for
 * a second tap while a PDF is already being made (no capture was started for it). The view shows what this returns.
 */
export async function downloadPdf(make: () => Promise<void>): Promise<string | null> {
  try {
    await make();
    return null;
  } catch (e) {
    return e instanceof BusyError ? PDF_BUSY_MESSAGE : PDF_FAIL_MESSAGE;
  }
}
