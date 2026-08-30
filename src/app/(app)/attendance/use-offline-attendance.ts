"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { candidateKey, matchCandidates } from "@/lib/attendance-match";
import { colomboNow } from "@/lib/colombo-time";
import {
  dropFromOutbox,
  queueMark,
  readOutbox,
  readWorkingSet,
  saveWorkingSet,
  type CachedWorkingSet,
  type OutboxItem,
} from "@/lib/offline-store";

import type {
  Method,
  QueuedMark,
  ScanResult,
  SyncOutcome,
  WorkingSet,
} from "./actions";

/** Browser connectivity, read as external state rather than synced in an effect. */
function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export type OfflineState = {
  online: boolean;
  /** null while the cache is still being read, or if IndexedDB is unavailable. */
  cache: CachedWorkingSet | null;
  /** True when the cached set was built for a different Colombo day. */
  stale: boolean;
  queued: number;
  syncing: boolean;
  lastSyncMessage: string | null;
};

/**
 * The offline half of the attendance terminal.
 *
 * `navigator.onLine` is a hint, not a guarantee — it only says the interface
 * has a route, not that the server answers — so nothing here relies on it to
 * decide correctness. The screen tries the server first and falls back on a
 * failed call; onLine is used for the banner and for knowing when to retry.
 */
export function useOfflineAttendance(deps: {
  loadWorkingSet: () => Promise<WorkingSet>;
  syncMarks: (items: QueuedMark[]) => Promise<SyncOutcome[]>;
}) {
  const { loadWorkingSet, syncMarks } = deps;

  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );

  const [cache, setCache] = useState<CachedWorkingSet | null>(null);
  /**
   * Whether the SERVER actually answered last time we asked.
   *
   * `navigator.onLine` is not enough and is measurably wrong: under Chrome's
   * own offline emulation it stays true while every request fails, and a
   * terminal on a live Wi-Fi network with a dead router behaves the same way.
   * The banner follows this observed value, not the flag.
   */
  const [reachable, setReachable] = useState(true);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  /**
   * One flush at a time. Mount and the reconnect effect can both fire, and two
   * concurrent flushes are harmless to the DATA — clientRef makes the second a
   * no-op — but they race on the status message, so the terminal would report
   * "0 synced, 1 already on record" for a mark it had just written itself.
   */
  const flushing = useRef(false);
  const [lastSyncMessage, setLastSyncMessage] = useState<string | null>(null);

  const refreshOutbox = useCallback(async () => {
    setOutbox(await readOutbox());
  }, []);

  /** Pull a fresh working set. Only ever called when the server is reachable. */
  const refreshCache = useCallback(async () => {
    try {
      const set = await loadWorkingSet();
      await saveWorkingSet(set);
      setCache(set);
      setReachable(true);
    } catch {
      // Offline, or the session expired. The previous cache stays usable.
      setReachable(false);
    }
  }, [loadWorkingSet]);

  /**
   * Flush the outbox. An item is dropped ONLY when the server says it settled,
   * so a half-finished flush simply retries — and because every item carries
   * its clientRef, retrying cannot write a second row.
   */
  const flush = useCallback(async () => {
    if (flushing.current) return;
    const items = await readOutbox();
    if (items.length === 0) return;

    flushing.current = true;
    setSyncing(true);
    try {
      const outcomes = await syncMarks(
        items.map((i) => ({
          clientRef: i.clientRef,
          studentId: i.studentId,
          courseId: i.courseId,
          additionalClassId: i.additionalClassId,
          method: i.method,
          date: i.date,
        })),
      );

      await dropFromOutbox(outcomes.filter((o) => o.settled).map((o) => o.clientRef));

      setReachable(true);
      const written = outcomes.filter((o) => o.status === "written").length;
      const duplicate = outcomes.filter((o) => o.status === "duplicate").length;
      const rejected = outcomes.filter((o) => o.status === "rejected").length;
      setLastSyncMessage(
        `Synced ${written} mark${written === 1 ? "" : "s"}` +
          (duplicate > 0 ? `, ${duplicate} already on record` : "") +
          (rejected > 0 ? `, ${rejected} rejected` : "") +
          ".",
      );
    } catch {
      // Still offline, or the flush was cut off. Nothing was dropped, so the
      // next attempt sends the same items again.
      setReachable(false);
      setLastSyncMessage("Couldn't reach the server — marks are still queued.");
    } finally {
      flushing.current = false;
      setSyncing(false);
      await refreshOutbox();
    }
  }, [syncMarks, refreshOutbox]);

  // First paint: read whatever the last session cached, then (if we can reach
  // the server) refresh it and drain anything the last session left queued.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await readWorkingSet();
      if (!cancelled && stored) setCache(stored);
      await refreshOutbox();
      if (navigator.onLine) {
        await refreshCache();
        await flush();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshCache, refreshOutbox, flush]);

  // Reconnected: top the cache up and drain the outbox.
  useEffect(() => {
    if (!online) return;
    void (async () => {
      await refreshCache();
      await flush();
    })();
  }, [online, refreshCache, flush]);

  const today = colomboNow().date;
  const stale = cache !== null && cache.date !== today;

  /** Write a mark to the outbox and report it as queued. */
  const queueOffline = useCallback(
    async (
      student: { id: number; name: string; school: string | null; cardNumber: string | null; photoUrl: string | null },
      candidate: Parameters<typeof candidateKey>[0] & { course: string },
      method: Method,
      clientRef: string,
      date: string,
      at: string,
    ): Promise<ScanResult> => {
      await queueMark({
        clientRef,
        studentId: student.id,
        studentName: student.name,
        courseId: candidate.courseId,
        additionalClassId: candidate.additionalClassId,
        course: candidate.course,
        method,
        date,
        at,
        queuedAt: Date.now(),
      });
      await refreshOutbox();
      return {
        status: "queued",
        student,
        candidate: candidate as never,
        at,
      };
    },
    [refreshOutbox],
  );

  /**
   * Typeahead over the cached working set. The online search is a server
   * action, so without this the search box — the only input that works when
   * there is no card to tap — would go dead exactly when it is needed most.
   */
  const searchOffline = useCallback(
    (query: string) => {
      const q = query.trim().toLowerCase();
      if (!cache || q.length < 2) return [];
      return cache.students
        .filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            (s.cardNumber ?? "").toLowerCase().includes(q) ||
            (s.school ?? "").toLowerCase().includes(q),
        )
        .slice(0, 10)
        .map((s) => ({
          id: s.id,
          name: s.name,
          school: s.school,
          cardNumber: s.cardNumber,
          photoUrl: null,
        }));
    },
    [cache],
  );

  /**
   * Resolve a scan with no network, against the cached working set and the
   * device clock. Returns the same ScanResult shape the server returns, plus
   * the offline-only outcomes.
   */
  const resolveOffline = useCallback(
    async (
      input: { cardUid?: string; cardNumber?: string; studentId?: number },
      method: Method,
      clientRef: string,
    ): Promise<ScanResult> => {
      if (!cache) {
        return {
          status: "offline-blocked",
          message:
            "No offline data on this device yet. Connect once so the day's classes can be cached.",
        };
      }
      if (cache.date !== colomboNow().date) {
        return {
          status: "offline-blocked",
          message: `Offline data is from ${cache.date}, not today. Reconnect to refresh before marking.`,
        };
      }

      const wantedUid = input.cardUid?.trim().replace(/[\s:-]/g, "").toUpperCase();
      const wantedNumber = input.cardNumber?.replace(/\s+/g, "");
      const student = cache.students.find(
        (s) =>
          (input.studentId !== undefined && s.id === input.studentId) ||
          (wantedUid !== undefined && s.cardUid === wantedUid) ||
          (wantedNumber !== undefined && s.cardNumber === wantedNumber),
      );
      // An unknown card is rejected offline exactly as it is online — it is
      // never queued on the hope that the server will recognise it.
      if (!student) return { status: "unknown" };

      const brief = {
        id: student.id,
        name: student.name,
        school: student.school,
        cardNumber: student.cardNumber,
        photoUrl: null,
      };

      // Marks queued on this device count as marked, so a second tap says
      // "already" instead of stacking a duplicate in the outbox.
      const queuedKeys = new Map(
        (await readOutbox())
          .filter((i) => i.studentId === student.id && i.date === cache.date)
          .map((i) => [candidateKey(i), i.at]),
      );

      const candidates = (cache.classes[student.id] ?? []).map((c) => ({
        ...c,
        markedAt: c.markedAt ?? queuedKeys.get(candidateKey(c)) ?? null,
      }));

      const now = colomboNow();
      const decision = matchCandidates(candidates, now.time);

      switch (decision.kind) {
        case "no-class":
          return { status: "no-class", student: brief };
        case "outside":
          return { status: "outside", student: brief, message: decision.message };
        case "already":
          return { status: "already", student: brief, candidate: decision.candidate, at: decision.at };
        case "confirm":
          return { status: "confirm", student: brief, candidate: decision.candidate };
        case "choose":
          return { status: "choose", student: brief, candidates: decision.candidates };
        case "mark":
          return queueOffline(brief, decision.candidate, method, clientRef, cache.date, now.time);
      }
    },
    [cache, queueOffline],
  );



  return {
    online,
    /** Online AND the server answered. This is what the UI should trust. */
    connected: online && reachable,
    setReachable,
    cache,
    stale,
    queued: outbox.length,
    syncing,
    lastSyncMessage,
    resolveOffline,
    searchOffline,
    queueOffline,
    flush,
    refreshCache,
  };
}
