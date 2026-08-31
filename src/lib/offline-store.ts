"use client";

import type { ArrearsBadge, Candidate } from "@/lib/attendance-match";

/**
 * The terminal's local store: the cached working set and the outbox of marks
 * taken while the router was down.
 *
 * IndexedDB rather than localStorage because the working set is a few hundred
 * KB of structured data and the outbox must survive a tab crash mid-flush.
 * Everything here is browser-only and is imported by the attendance screen
 * alone — nothing on the server may reach it.
 */

const DB_NAME = "xenon-attendance";
const DB_VERSION = 1;
const META = "meta";
const OUTBOX = "outbox";
const WORKING_SET_KEY = "workingSet";

export type CachedWorkingSet = {
  date: string;
  builtAt: number;
  students: {
    id: number;
    name: string;
    school: string | null;
    cardUid: string | null;
    cardNumber: string | null;
  }[];
  classes: Record<number, Candidate[]>;
  /** Precomputed at each online refresh — the colour survives the outage. */
  arrears: Record<number, ArrearsBadge>;
};

export type OutboxItem = {
  clientRef: string;
  studentId: number;
  studentName: string;
  courseId: number;
  additionalClassId: number | null;
  course: string;
  method: "NFC" | "QR" | "SEARCH";
  date: string;
  /**
   * Offline the device clock is the only clock, so this is best-effort: it is
   * what the terminal believed the time was, not a server timestamp.
   */
  at: string;
  queuedAt: number;
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      if (!db.objectStoreNames.contains(OUTBOX)) {
        db.createObjectStore(OUTBOX, { keyPath: "clientRef" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  body: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = body(tx.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

/** IndexedDB can be unavailable (private mode, locked-down WebView). Fail soft. */
const safe = <T,>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);

export const saveWorkingSet = (set: CachedWorkingSet) =>
  safe(run(META, "readwrite", (s) => s.put(set, WORKING_SET_KEY)).then(() => true), false);

export const readWorkingSet = () =>
  safe(
    run<CachedWorkingSet | undefined>(META, "readonly", (s) => s.get(WORKING_SET_KEY)).then(
      (v) => v ?? null,
    ),
    null,
  );

export const queueMark = (item: OutboxItem) =>
  safe(run(OUTBOX, "readwrite", (s) => s.put(item)).then(() => true), false);

export const readOutbox = () =>
  safe(run<OutboxItem[]>(OUTBOX, "readonly", (s) => s.getAll()), []);

/** Only ever called with refs the server has confirmed it has settled. */
export async function dropFromOutbox(clientRefs: string[]): Promise<void> {
  if (clientRefs.length === 0) return;
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(OUTBOX, "readwrite");
      const store = tx.objectStore(OUTBOX);
      for (const ref of clientRefs) store.delete(ref);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // A failed delete only means the item is retried; the server dedupes it.
  }
}
