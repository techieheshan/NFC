/**
 * Runs `run` with a <style> element on the page, and takes it off AGAIN however `run` ends (returns, throws, or rejects).
 * Used by the PDF step, whose image rule changes every image in the app while it is on the page.
 */
export async function withTemporaryStyle<T>(
  doc: Pick<Document, "createElement" | "head">,
  css: string,
  run: () => Promise<T>,
): Promise<T> {
  const el = doc.createElement("style");
  el.textContent = css;
  doc.head.appendChild(el);
  try {
    return await run();
  } finally {
    el.remove();
  }
}
