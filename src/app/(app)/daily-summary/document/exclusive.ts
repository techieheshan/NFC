/** Thrown when a second PDF is asked for while one is being made. */
export class BusyError extends Error {
  constructor() {
    super("a PDF is already being made");
    this.name = "BusyError";
  }
}

/**
 * Lets one job run at a time. A second `run` while one is in progress is refused at once (BusyError), it does not wait: two
 * captures at the same time double the memory a slow terminal needs. The lock is released however the job ends.
 */
export function createLock() {
  let held = false;
  return {
    get held() { return held; },
    async run<T>(job: () => Promise<T>): Promise<T> {
      if (held) throw new BusyError();
      held = true;
      try {
        return await job();
      } finally {
        held = false;
      }
    },
  };
}
