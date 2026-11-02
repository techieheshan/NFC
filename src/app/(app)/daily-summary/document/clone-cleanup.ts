/**
 * html2canvas draws from a hidden <iframe class="html2canvas-container"> copy of the whole page, and takes it off again only
 * after a SUCCESSFUL draw. After a failure or a deadline the copy stays in the page (memory on a small terminal). This remembers
 * which such elements were already there before the capture and removes only the ones that appeared since: never one it did
 * not see being added.
 */
export type Removable = { remove(): void };

export function trackNew<E extends Removable>(find: () => Iterable<E>) {
  const before = new Set<E>(find());
  return {
    /** Removes every matching element that was not there at the start. Returns how many. */
    removeNew(): number {
      let n = 0;
      for (const el of [...find()]) {
        if (before.has(el)) continue;
        el.remove();
        n++;
      }
      return n;
    },
  };
}

export const CLONE_SELECTOR = "iframe.html2canvas-container";
