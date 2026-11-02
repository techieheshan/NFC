import "server-only";

import { Prisma } from "@prisma/client";

import { decimalToCents } from "@/lib/cents";
import { colomboDateValue, colomboNow } from "@/lib/colombo-time";
import { parseRealDate, resolveDay } from "@/lib/daily-summary-dates";
import { cancelledReceipts, collectedByStaff } from "@/lib/daily-summary-extras";
import { db } from "@/lib/db";
import { displayName } from "@/lib/display-name";
import { dailySummary } from "@/lib/reports";

import { matchBankLines, type StoredBankLine } from "./bank-lines";
import { changesForEdit, changesForResave, changesForSave, parseChanges, type ChangeItem } from "./changes";
import { classifyEdit, decideCheck, type EditShape, type SaveKind } from "./check-rule";
import { decideBase } from "./conflict";
import { diffSummaries, type FigureDiff } from "./diff";
import { chooseHint, hintWindow, type Hint } from "./hint";
import { DS_LOCK_NAMESPACE, LOCK_WAIT_MS, lockKey, TX_MAX_WAIT_MS, TX_TIMEOUT_MS } from "./lock";
import { centsToDecimalString, columnToCents } from "./money";
import { retentionCutoff } from "./retention";
import { buildSnapshot, cashBookColumns, cashBookOf, parseSnapshot, SNAPSHOT_SCHEMA, SnapshotError, type CashBook, type Snapshot } from "./snapshot";
import { echoValues, parseSaveInput, type SaveValues } from "./validate";

/**
 * The saved-day logic that touches the database. The `"use server"` actions (`daily-summary/saved-actions.ts`) check the role first
 * and call these; nothing else may.
 *
 * Rules this file keeps (see the plan, ~/xenon-release/DAILY-SUMMARY-R2-PLAN.md):
 *  - The SERVER takes its own snapshot of the numbers; the client's `seen` figures are only a stale check and are never stored.
 *  - The snapshot is read BEFORE the transaction opens: a read through `db` inside it would take a second pooled connection while the
 *    day's lock is held. Inside the transaction only `tx` is used.
 *  - Every guard comes before the first write; a refusal returned from the transaction callback has written nothing.
 *  - A version is written once and never updated. A check is its own row.
 *  - Dates are Colombo days (`colombo-time`); money is integer cents, written as text built by integer arithmetic.
 */

type Actor = { id: string; role: string };
type DoneBy = { id: string; name: string };

export type ConflictInfo = { version: number; kind: SaveKind; savedAt: string; doneByName: string; changes: ChangeItem[] };

export type RefusalReason =
  | "invalid"
  | "date"
  | "done-by"
  | "over-bank"
  | "nothing-changed"
  | "conflict"
  | "numbers-moved"
  | "busy"
  | "corrupt";

export type SaveOutcome =
  | { ok: true; date: string; version: number; kind: SaveKind; changes: ChangeItem[]; purged: number }
  | {
      ok: false;
      reason: RefusalReason;
      message: string;
      /** What was submitted, sanitised, so the form can show it again (rule 14). */
      values: SaveValues;
      fieldErrors?: Record<string, string>;
      current?: ConflictInfo;
      /** The figures as they are now (numbers-moved only). */
      fresh?: { collected: number; deductions: number };
    };

export type CheckOutcome =
  | { ok: true; date: string; version: number; checkedByName: string; markedByName: string; checkedAt: string }
  | { ok: false; reason: "invalid" | "not-admin" | "not-saved" | "conflict" | "already-checked" | "busy"; message: string; current?: ConflictInfo };

const MESSAGE = {
  busy: "The day didn't save in time and nothing was saved. Try again.",
  checkBusy: "The check didn't go through in time and nothing was recorded. Try again.",
  overBank: "The money taken to the bank is more than the drawer should hold.",
  nothing: "Nothing changed.",
  numbersMoved: "The numbers moved while you were looking. Check them and save again.",
  doneBy: "Choose who did this from the list.",
  future: "That day has not happened yet.",
  tooOld: "Saved days are kept for 3 months, and that day is older, so it cannot be saved.",
  corrupt: "This saved day was written by a newer version of the app and cannot be changed here.",
} as const;

// ---- small helpers ----

const nameOf = (u: { username: string; staff?: { name: string } | null }) => displayName(u);
const userSelect = { id: true, username: true, staff: { select: { name: true } } } as const;

/** True when the transaction could not run in time: it expired (P2028) or the day's lock was not free within LOCK_WAIT_MS (55P03). */
function isBusyError(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (e.code === "P2028") return true;
  let detail = e.message;
  try {
    detail += ` ${JSON.stringify(e.meta ?? {})}`;
  } catch {
    // meta that cannot be serialised must not replace the real error
  }
  return /55P03|lock timeout/i.test(detail);
}

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

const versionInclude = { bankLines: { orderBy: { position: "asc" as const } }, check: true } satisfies Prisma.DailySummaryVersionInclude;
type VersionRow = Prisma.DailySummaryVersionGetPayload<{ include: typeof versionInclude }>;

const storedLines = (v: VersionRow): StoredBankLine[] =>
  v.bankLines.map((b) => ({ cents: columnToCents(b.amount), time: b.time, slip: b.slip, note: b.note, recordedById: b.recordedById, recordedAt: b.recordedAt }));

const conflictInfo = (v: VersionRow): ConflictInfo => ({
  version: v.version,
  kind: v.kind,
  savedAt: v.savedAt.toISOString(),
  doneByName: v.doneByName,
  changes: parseChanges(v.changes),
});

/** The numbers as they are right now: `dailySummary()` untouched plus the two read-only helpers. */
async function freshSnapshot(date: string): Promise<Snapshot> {
  const [report, cancelled, staff] = await Promise.all([dailySummary(date, date), cancelledReceipts(date, date), collectedByStaff(date, date)]);
  return buildSnapshot({ report, cancelled, staff });
}

const figures = (s: Snapshot) => ({ collected: decimalToCents(s.report.totalCollected), deductions: decimalToCents(s.report.deductions.total) });

/** An ACTIVE ADMIN or STAFF user, looked up on the server. A client-supplied id is only ever a key into this. */
async function findDoneBy(id: string): Promise<DoneBy | null> {
  const u = await db.user.findFirst({ where: { id, active: true, role: { in: ["ADMIN", "STAFF"] } }, select: userSelect });
  return u ? { id: u.id, name: nameOf(u) } : null;
}

// ---- retention (lazy) ----

/** Deletes saved days older than three months (and, by cascade, their versions, deposits and checks). Returns how many days. */
export async function purgeExpired(): Promise<number> {
  const cutoff = retentionCutoff(colomboNow().date);
  const r = await db.dailySummaryDay.deleteMany({ where: { date: { lt: colomboDateValue(cutoff) } } });
  return r.count;
}

/** The purge as the actions use it: a separate statement after the real work, and a failure never reaches the person. */
export async function tryPurge(): Promise<number> {
  try {
    return await purgeExpired();
  } catch (e) {
    console.error("saved-day purge failed (will retry on the next save or History open):", e);
    return 0;
  }
}

// ---- save / edit / re-save ----

export async function saveDayAs(actor: Actor, raw: unknown): Promise<SaveOutcome> {
  const parsed = parseSaveInput(raw);
  if (!parsed.ok) return { ok: false, reason: "invalid", message: parsed.message, fieldErrors: parsed.fieldErrors, values: parsed.values };
  const p = parsed.value;
  const values = echoValues(raw);
  const refuse = (reason: RefusalReason, message: string, extra: { current?: ConflictInfo; fresh?: { collected: number; deductions: number } } = {}): SaveOutcome => ({
    ok: false, reason, message, values, ...extra,
  });

  const today = colomboNow().date;
  if (p.date > today) return refuse("date", MESSAGE.future);
  // A day already older than the retention window would be deleted by the purge a moment after it was saved: refuse it plainly.
  if (p.date < retentionCutoff(today)) return refuse("date", MESSAGE.tooOld);

  const doneBy = await findDoneBy(p.doneById);
  if (!doneBy) return refuse("done-by", MESSAGE.doneBy);

  // The server's own numbers, read before the transaction. The sheet's figures are only compared with them.
  let fresh: Snapshot | null = null;
  if (p.mode !== "edit") {
    fresh = await freshSnapshot(p.date);
    const f = figures(fresh);
    if (!p.seen || p.seen.collected !== f.collected || p.seen.deductions !== f.deductions) return refuse("numbers-moved", MESSAGE.numbersMoved, { fresh: f });
  }

  const dateValue = colomboDateValue(p.date);
  const now = new Date();

  try {
    const outcome = await db.$transaction(
      async (tx): Promise<SaveOutcome> => {
        await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${LOCK_WAIT_MS}ms`}, true)`; // this transaction only
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DS_LOCK_NAMESPACE}::int, ${lockKey(p.date)}::int)`;

        const day = await tx.dailySummaryDay.findUnique({
          where: { date: dateValue },
          include: { versions: { orderBy: { version: "desc" }, take: 1, include: versionInclude } },
        });
        const current = day?.versions[0] ?? null;

        const decision = decideBase(p.baseVersion, day ? day.currentVersion : null);
        if (!decision.ok) {
          if (decision.reason === "bad-base") return refuse("invalid", "That could not be read. Reload the page and try again.");
          if (decision.reason === "not-saved") return refuse("conflict", "This day is no longer saved (saved details are kept for 3 months). Nothing was changed.");
          return refuse("conflict", `${current?.doneByName ?? "Someone"} saved this day (version ${current?.version ?? "?"}) while you were working. Your changes were NOT saved.`, current ? { current: conflictInfo(current) } : {});
        }
        // modes must match what is stored: a first save has no day, an edit and a re-save need one
        if ((p.mode === "save") !== (current === null)) return refuse("conflict", "The day changed while you were working. Reload it and try again.", current ? { current: conflictInfo(current) } : {});

        let kind: SaveKind;
        let snapshot: Snapshot;
        let snapshotJson: Prisma.InputJsonValue;
        let bringForwardCents: number;
        let items: ChangeItem[];
        let lines: StoredBankLine[];
        let carry: { checkedById: string; checkedByName: string; markedById: string; markedByName: string; checkedAt: Date; carriedFromVersion: number } | null = null;
        let preparedBy: { id: string; name: string };

        if (current === null) {
          // ---- first save ----
          kind = "SAVE";
          snapshot = fresh!;
          snapshotJson = snapshot as unknown as Prisma.InputJsonValue;
          bringForwardCents = p.bringForwardCents;
          lines = matchBankLines([], p.bank, doneBy.id, now).lines;
          items = changesForSave(doneBy.name);
          preparedBy = doneBy;
        } else {
          let saved: Snapshot;
          try {
            saved = parseSnapshot(current.snapshot, current.snapshotSchema);
          } catch (e) {
            if (e instanceof SnapshotError) return refuse("corrupt", MESSAGE.corrupt);
            throw e;
          }
          const prevLines = storedLines(current);
          const prevShape: EditShape = { bringForwardCents: columnToCents(current.bringForward), bank: prevLines };
          const check = current.check;
          preparedBy = { id: current.preparedById, name: current.preparedByName };

          if (p.mode === "edit") {
            kind = "EDIT";
            const next: EditShape = { bringForwardCents: p.bringForwardCents, bank: p.bank };
            const edit = classifyEdit(prevShape, next);
            const d = decideCheck({ kind, hadCheck: check !== null, edit });
            if (d.refuse) return refuse("nothing-changed", MESSAGE.nothing);
            snapshot = saved;
            snapshotJson = current.snapshot as Prisma.InputJsonValue;
            bringForwardCents = p.bringForwardCents;
            const match = matchBankLines(prevLines, p.bank, doneBy.id, now);
            lines = match.lines;
            items = changesForEdit({
              by: doneBy.name,
              prevBf: prevShape.bringForwardCents,
              nextBf: bringForwardCents,
              match,
              check: check ? (d.checkCleared ? { cleared: { by: check.checkedByName, at: check.checkedAt.toISOString() } } : d.carryCheck ? { kept: check.checkedByName } : undefined) : undefined,
            });
            if (check && d.carryCheck) carry = { checkedById: check.checkedById, checkedByName: check.checkedByName, markedById: check.markedById, markedByName: check.markedByName, checkedAt: check.checkedAt, carriedFromVersion: current.version };
          } else {
            kind = "RESAVE_LIVE";
            const diffs: FigureDiff[] = diffSummaries(saved, fresh!);
            const d = decideCheck({ kind, hadCheck: check !== null, liveDiffers: diffs.length > 0 });
            if (d.refuse) return refuse("nothing-changed", MESSAGE.nothing);
            snapshot = fresh!;
            snapshotJson = snapshot as unknown as Prisma.InputJsonValue;
            bringForwardCents = prevShape.bringForwardCents; // a re-save refreshes the numbers only; it keeps what was typed
            lines = prevLines;
            items = changesForResave({ by: doneBy.name, diffs, cleared: check && d.checkCleared ? { by: check.checkedByName, at: check.checkedAt.toISOString() } : undefined });
          }
        }

        const book: CashBook = cashBookOf(snapshot, bringForwardCents, lines);
        if (book.overdrawn) return refuse("over-bank", MESSAGE.overBank);

        // ---- guards done: writes only below this line ----
        const version = (current?.version ?? 0) + 1;
        let dayId: number;
        if (day === null) {
          dayId = (await tx.dailySummaryDay.create({ data: { date: dateValue, currentVersion: 1 }, select: { id: true } })).id;
        } else {
          const moved = await tx.dailySummaryDay.updateMany({ where: { id: day.id, currentVersion: p.baseVersion }, data: { currentVersion: version } });
          if (moved.count !== 1) return refuse("conflict", "The day changed while you were working. Reload it and try again.");
          dayId = day.id;
        }
        await tx.dailySummaryVersion.create({
          data: {
            dayId,
            version,
            kind,
            ...cashBookColumns(book),
            snapshot: snapshotJson,
            snapshotSchema: SNAPSHOT_SCHEMA,
            changes: items as unknown as Prisma.InputJsonValue,
            doneById: doneBy.id,
            doneByName: doneBy.name,
            preparedById: preparedBy.id,
            preparedByName: preparedBy.name,
            savedById: actor.id,
            bankLines: {
              create: lines.map((l, i) => ({
                position: i + 1,
                time: l.time,
                amount: centsToDecimalString(l.cents),
                slip: l.slip,
                note: l.note,
                recordedById: l.recordedById,
                recordedAt: l.recordedAt,
              })),
            },
            ...(carry ? { check: { create: carry } } : {}),
          },
        });
        return { ok: true, date: p.date, version, kind, changes: items, purged: 0 };
      },
      { maxWait: TX_MAX_WAIT_MS, timeout: TX_TIMEOUT_MS },
    );

    if (outcome.ok) outcome.purged = await tryPurge(); // after the commit, as a separate statement
    return outcome;
  } catch (e) {
    if (isBusyError(e)) return refuse("busy", MESSAGE.busy);
    if (isUniqueViolation(e)) return refuse("conflict", "Someone saved this day while you were working. Reload it and try again.");
    throw e;
  }
}

// ---- mark as checked ----

export async function markCheckedAs(actor: Actor, raw: unknown): Promise<CheckOutcome> {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const date = parseRealDate(o.date);
  const base = o.baseVersion;
  const adminId = typeof o.checkedById === "string" && o.checkedById.length > 0 && o.checkedById.length <= 64 ? o.checkedById : null;
  if (date === null || typeof base !== "number" || !Number.isInteger(base) || base < 1 || base > 1_000_000 || adminId === null) {
    return { ok: false, reason: "invalid", message: "That could not be read. Reload the page and try again." };
  }

  // The admin named must be an ACTIVE ADMIN, looked up here. The person who taps may be ADMIN or STAFF (the caller checked the role).
  const admin = await db.user.findFirst({ where: { id: adminId, active: true, role: "ADMIN" }, select: userSelect });
  if (!admin) return { ok: false, reason: "not-admin", message: "Choose an active admin from the list." };
  const marker = await db.user.findUnique({ where: { id: actor.id }, select: userSelect });
  const markedByName = marker ? nameOf(marker) : "unknown";
  const checkedByName = nameOf(admin);
  const dateValue = colomboDateValue(date);
  const now = new Date();

  try {
    return await db.$transaction(
      async (tx): Promise<CheckOutcome> => {
        await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${LOCK_WAIT_MS}ms`}, true)`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DS_LOCK_NAMESPACE}::int, ${lockKey(date)}::int)`;

        const day = await tx.dailySummaryDay.findUnique({
          where: { date: dateValue },
          include: { versions: { orderBy: { version: "desc" }, take: 1, include: versionInclude } },
        });
        const current = day?.versions[0] ?? null;
        if (!day || !current) return { ok: false, reason: "not-saved", message: "This day is not saved, so there is nothing to check." };
        if (current.version !== base) {
          return {
            ok: false,
            reason: "conflict",
            message: `${current.doneByName} changed this day (now version ${current.version}) after you opened it. Look at the new numbers and check again.`,
            current: conflictInfo(current),
          };
        }
        if (current.check) return { ok: false, reason: "already-checked", message: `Already checked by ${current.check.checkedByName}.`, current: conflictInfo(current) };

        // ---- guards done: the one write ----
        await tx.dailySummaryCheck.create({
          data: { versionId: current.id, checkedById: admin.id, checkedByName, markedById: actor.id, markedByName, checkedAt: now },
        });
        return { ok: true, date, version: current.version, checkedByName, markedByName, checkedAt: now.toISOString() };
      },
      { maxWait: TX_MAX_WAIT_MS, timeout: TX_TIMEOUT_MS },
    );
  } catch (e) {
    if (isBusyError(e)) return { ok: false, reason: "busy", message: MESSAGE.checkBusy };
    if (isUniqueViolation(e)) return { ok: false, reason: "already-checked", message: "Already checked." };
    throw e;
  }
}

// ---- reads ----

export type LogEntry = { version: number; kind: SaveKind; savedAt: string; doneByName: string; savedByName: string; items: ChangeItem[] };

export type SavedDayView = {
  date: string;
  version: number;
  kind: SaveKind;
  savedAt: string;
  /** The cash book of this version, in integer cents. */
  cash: Omit<CashBook, "overdrawn">;
  snapshot: Snapshot;
  bank: { position: number; time: string; cents: number; slip: string; note: string; recordedById: string; recordedByName: string; recordedAt: string }[];
  preparedBy: { id: string; name: string };
  doneBy: { id: string; name: string };
  savedByName: string;
  check: null | { checkedById: string; checkedByName: string; markedById: string; markedByName: string; checkedAt: string; carriedFromVersion: number | null };
  /** Every version, oldest first. */
  log: LogEntry[];
};

export type SavedDayRead = {
  date: string;
  saved: SavedDayView | null;
  /** Saved day only: how the live figures differ from the frozen ones (empty = identical). */
  liveDiffs: FigureDiff[];
  hint: Hint | null;
};

export async function loadSavedDayAs(rawDate: unknown): Promise<SavedDayRead> {
  const date = resolveDay(rawDate, colomboNow().date);
  const day = await db.dailySummaryDay.findUnique({
    where: { date: colomboDateValue(date) },
    select: {
      id: true,
      currentVersion: true,
      versions: {
        orderBy: { version: "asc" },
        select: {
          id: true, version: true, kind: true, savedAt: true, bringForward: true, collected: true, deductions: true, shouldBeInDrawer: true, bankTotal: true,
          leftInDrawer: true, net: true, changes: true, snapshotSchema: true, doneById: true, doneByName: true, preparedById: true, preparedByName: true,
          savedBy: { select: userSelect },
          bankLines: { orderBy: { position: "asc" }, select: { position: true, time: true, amount: true, slip: true, note: true, recordedById: true, recordedAt: true, recordedBy: { select: userSelect } } },
          check: true,
        },
      },
    },
  });

  let saved: SavedDayView | null = null;
  let liveDiffs: FigureDiff[] = [];
  if (day && day.versions.length > 0) {
    const v = day.versions[day.versions.length - 1];
    const snapRow = await db.dailySummaryVersion.findUnique({ where: { id: v.id }, select: { snapshot: true, snapshotSchema: true } });
    const snapshot = parseSnapshot(snapRow?.snapshot, snapRow?.snapshotSchema ?? 0);
    saved = {
      date,
      version: v.version,
      kind: v.kind,
      savedAt: v.savedAt.toISOString(),
      cash: {
        bringForward: columnToCents(v.bringForward), collected: columnToCents(v.collected), deductions: columnToCents(v.deductions),
        shouldBeInDrawer: columnToCents(v.shouldBeInDrawer), bankTotal: columnToCents(v.bankTotal), leftInDrawer: columnToCents(v.leftInDrawer), net: columnToCents(v.net),
      },
      snapshot,
      bank: v.bankLines.map((b) => ({
        position: b.position, time: b.time, cents: columnToCents(b.amount), slip: b.slip, note: b.note,
        recordedById: b.recordedById, recordedByName: nameOf(b.recordedBy), recordedAt: b.recordedAt.toISOString(),
      })),
      preparedBy: { id: v.preparedById, name: v.preparedByName },
      doneBy: { id: v.doneById, name: v.doneByName },
      savedByName: nameOf(v.savedBy),
      check: v.check && {
        checkedById: v.check.checkedById, checkedByName: v.check.checkedByName, markedById: v.check.markedById, markedByName: v.check.markedByName,
        checkedAt: v.check.checkedAt.toISOString(), carriedFromVersion: v.check.carriedFromVersion,
      },
      log: day.versions.map((x) => ({
        version: x.version, kind: x.kind, savedAt: x.savedAt.toISOString(), doneByName: x.doneByName, savedByName: nameOf(x.savedBy), items: parseChanges(x.changes),
      })),
    };
    liveDiffs = diffSummaries(snapshot, await freshSnapshot(date));
  }

  // The hint is only useful while the bring-forward is still empty: an unsaved day, or a saved one with no bring-forward.
  let hint: Hint | null = null;
  if (saved === null || saved.cash.bringForward === 0) hint = await findHint(date);
  return { date, saved, liveDiffs, hint };
}

async function findHint(date: string): Promise<Hint | null> {
  const w = hintWindow(date);
  const days = await db.dailySummaryDay.findMany({
    where: { date: { gte: colomboDateValue(w.from), lte: colomboDateValue(w.to) } },
    select: { id: true, date: true, currentVersion: true },
  });
  if (days.length === 0) return null;
  const versions = await db.dailySummaryVersion.findMany({
    where: { OR: days.map((d) => ({ dayId: d.id, version: d.currentVersion })) },
    select: { dayId: true, leftInDrawer: true, check: { select: { id: true } } },
  });
  const byDay = new Map(versions.map((v) => [v.dayId, v]));
  return chooseHint(
    date,
    days.flatMap((d) => {
      const v = byDay.get(d.id);
      return v ? [{ date: d.date.toISOString().slice(0, 10), leftCents: columnToCents(v.leftInDrawer), checked: v.check !== null }] : [];
    }),
  );
}

export type HistoryRow = { date: string; version: number; doneByName: string; savedAt: string; collected: number; net: number; checked: boolean };
export type HistoryRead = { month: string; rows: HistoryRow[]; purged: number };

/** `YYYY-MM` within 2000..2100, else the current Colombo month. Validated ONCE: the query and the heading use this one value (rule 23). */
export function resolveMonth(raw: unknown, todayYmd: string): string {
  if (typeof raw === "string") {
    const m = /^(\d{4})-(\d{2})$/.exec(raw);
    if (m && Number(m[1]) >= 2000 && Number(m[1]) <= 2100 && Number(m[2]) >= 1 && Number(m[2]) <= 12) return raw;
  }
  return todayYmd.slice(0, 7);
}

export async function loadHistoryAs(rawMonth: unknown): Promise<HistoryRead> {
  const month = resolveMonth(rawMonth, colomboNow().date);
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const last = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  const days = await db.dailySummaryDay.findMany({
    where: { date: { gte: colomboDateValue(first), lte: colomboDateValue(last) } },
    orderBy: { date: "desc" },
    select: { id: true, date: true, currentVersion: true },
  });
  const versions = days.length === 0 ? [] : await db.dailySummaryVersion.findMany({
    where: { OR: days.map((d) => ({ dayId: d.id, version: d.currentVersion })) },
    select: { dayId: true, version: true, doneByName: true, savedAt: true, collected: true, net: true, check: { select: { id: true } } },
  });
  const byDay = new Map(versions.map((v) => [v.dayId, v]));
  const rows = days.flatMap((d): HistoryRow[] => {
    const v = byDay.get(d.id);
    return v ? [{ date: d.date.toISOString().slice(0, 10), version: v.version, doneByName: v.doneByName, savedAt: v.savedAt.toISOString(), collected: columnToCents(v.collected), net: columnToCents(v.net), checked: v.check !== null }] : [];
  });
  const purged = await tryPurge(); // separate statement after the read; a failure is logged and ignored
  return { month, rows, purged };
}
