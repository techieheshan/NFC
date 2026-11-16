import { amountErrorText, parseTypedAmount } from "@/lib/cents";
import { parseRealDate } from "@/lib/daily-summary-dates";

/**
 * Salary adjustments: share an expense with named teachers and/or staff (they pay part of it), or pay them part of an income as a bonus.
 * Pure rules, no database: the screen, the server action and the tests read the same text. Money is integer cents (AGENTS 4).
 *
 * The rules the owner decided: split among selected teachers and/or staff, equal or custom, with Xenon's own share shown; the payroll month
 * is the CURRENT month or a later one (past months are locked); consent is required text. The server recomputes every amount: for an EQUAL
 * split the browser sends the people and the total to share, never the per-person amounts.
 */

export const TITLE_MAX = 80;
export const CONSENT_MAX = 300;
export const CANCEL_REASON_MIN = 3;
export const CANCEL_REASON_MAX = 300;
export const MAX_PEOPLE = 40;
/** How many months ahead an adjustment may be placed (the current month is month 0). */
export const MONTHS_AHEAD = 12;

export type Person = { kind: "teacher" | "staff"; id: number };
export const personKey = (p: Person) => `${p.kind === "teacher" ? "t" : "s"}${p.id}`;
export function parsePersonKey(raw: unknown): Person | null {
  const m = /^([ts])(\d{1,9})$/.exec(typeof raw === "string" ? raw.trim() : "");
  if (!m || Number(m[2]) <= 0) return null;
  return { kind: m[1] === "t" ? "teacher" : "staff", id: Number(m[2]) };
}

/** The payroll month as {year, month}, from "2026-11" (a real month in 2000..2100). */
export function parsePayrollMonth(raw: unknown): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(typeof raw === "string" ? raw.trim() : "");
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return year >= 2000 && year <= 2100 && month >= 1 && month <= 12 ? { year, month } : null;
}

const index = (p: { year: number; month: number }) => p.year * 12 + (p.month - 1);

/** The month is the current one or later, and at most MONTHS_AHEAD ahead. A past month is locked. */
export function payrollMonthState(target: { year: number; month: number }, current: { year: number; month: number }): "ok" | "past" | "too-far" {
  const d = index(target) - index(current);
  return d < 0 ? "past" : d > MONTHS_AHEAD ? "too-far" : "ok";
}

export const MONTH_LOCKED = "That month is already closed. An adjustment can be placed in this month or a later one.";
export const MONTH_TOO_FAR = `An adjustment can be placed at most ${MONTHS_AHEAD} months ahead.`;

/**
 * Splits `totalCents` equally among `n` people: whole cents only, the remainder cents go to the FIRST people in the order given (the
 * caller passes them in a fixed id order), one cent each. Deterministic; the parts always add up to the total; no two differ by more than a cent.
 */
export function splitEqual(totalCents: number, n: number): number[] {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0 || !Number.isInteger(n) || n <= 0) throw new RangeError("splitEqual needs whole cents and at least one person");
  const base = Math.floor(totalCents / n);
  const extra = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

export type AdjustmentKind = "SHARED_EXPENSE" | "BONUS";
export type SplitModeValue = "EQUAL" | "CUSTOM";

export type AdjustmentInput = {
  kind: AdjustmentKind;
  sourceId: number;
  title: string;
  year: number;
  month: number;
  splitMode: SplitModeValue;
  /** EQUAL: the amount to share among the people (cents). CUSTOM: unused. */
  sharedCents: number | null;
  people: { person: Person; cents: number | null }[];
  consentNote: string;
  consentOn: string;
};
export type AdjustmentParse = { ok: true; value: AdjustmentInput } | { ok: false; error: string };

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const positiveInt = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(text(v));
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Reads what the form sent. `current` and `today` are the Colombo month and day (rule 15), passed in so a test can freeze them.
 * Nothing is trusted: ids are only keys the action looks up, and the people list is de-duplicated by refusing a repeat.
 */
export function parseAdjustmentInput(raw: unknown, current: { year: number; month: number }, today: string): AdjustmentParse {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "That could not be read. Reload the page and try again." };
  const r = raw as Record<string, unknown>;

  const kind = text(r.kind);
  if (kind !== "SHARED_EXPENSE" && kind !== "BONUS") return { ok: false, error: "Pick expense or income." };
  const sourceId = positiveInt(r.sourceId);
  if (sourceId === null) return { ok: false, error: kind === "SHARED_EXPENSE" ? "Pick the expense." : "Pick the income." };

  const title = text(r.title);
  if (title.length < 2 || title.length > TITLE_MAX) return { ok: false, error: `Give it a title (2 to ${TITLE_MAX} characters).` };

  const when = parsePayrollMonth(r.month);
  if (!when) return { ok: false, error: "Pick the payroll month." };
  const state = payrollMonthState(when, current);
  if (state === "past") return { ok: false, error: MONTH_LOCKED };
  if (state === "too-far") return { ok: false, error: MONTH_TOO_FAR };

  const splitMode = text(r.splitMode);
  if (splitMode !== "EQUAL" && splitMode !== "CUSTOM") return { ok: false, error: "Pick equal or custom amounts." };

  if (!Array.isArray(r.people) || r.people.length === 0) return { ok: false, error: "Pick at least one teacher or staff member." };
  if (r.people.length > MAX_PEOPLE) return { ok: false, error: `Pick at most ${MAX_PEOPLE} people.` };
  const people: AdjustmentInput["people"] = [];
  const seen = new Set<string>();
  for (const item of r.people) {
    const o = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const person = parsePersonKey(o.key);
    if (!person) return { ok: false, error: "That person could not be read. Reload the page." };
    const key = personKey(person);
    if (seen.has(key)) return { ok: false, error: "The same person is picked twice." };
    seen.add(key);
    if (splitMode === "CUSTOM") {
      const a = parseTypedAmount(text(o.amount));
      if (!a.ok) return { ok: false, error: amountErrorText(a.reason) };
      if (a.cents <= 0) return { ok: false, error: "Every person needs an amount above zero." };
      people.push({ person, cents: a.cents });
    } else {
      people.push({ person, cents: null });
    }
  }

  let sharedCents: number | null = null;
  if (splitMode === "EQUAL") {
    const a = parseTypedAmount(text(r.shared));
    if (!a.ok) return { ok: false, error: amountErrorText(a.reason) };
    if (a.cents <= 0) return { ok: false, error: "The amount to share must be above zero." };
    sharedCents = a.cents;
  }

  const consentNote = text(r.consentNote);
  if (consentNote.length < 3) return { ok: false, error: "Write who agreed and how (required)." };
  if (consentNote.length > CONSENT_MAX) return { ok: false, error: `The consent note is too long (most ${CONSENT_MAX} characters).` };
  const consentOn = parseRealDate(text(r.consentOn));
  if (!consentOn) return { ok: false, error: "Pick the date they agreed." };
  if (consentOn > today) return { ok: false, error: "The date they agreed cannot be in the future." };

  return { ok: true, value: { kind, sourceId, title, year: when.year, month: when.month, splitMode, sharedCents, people, consentNote, consentOn } };
}

export type Lines = { ok: true; lines: { person: Person; cents: number }[]; sharedCents: number; instituteCents: number } | { ok: false; error: string };

/**
 * The amounts, in cents, from the source's total. EQUAL: the shared amount is split among the people (id order within teachers then staff:
 * the order of `people` as sorted by the caller). CUSTOM: each person's typed amount. Xenon's own share is what is left, and is never negative.
 */
export function buildLines(totalCents: number, input: Pick<AdjustmentInput, "splitMode" | "sharedCents" | "people">): Lines {
  const people = [...input.people].sort((a, b) => (a.person.kind === b.person.kind ? a.person.id - b.person.id : a.person.kind === "teacher" ? -1 : 1));
  let lines: { person: Person; cents: number }[];
  if (input.splitMode === "EQUAL") {
    const shared = input.sharedCents ?? 0;
    const parts = splitEqual(shared, people.length);
    if (parts.some((c) => c <= 0)) return { ok: false, error: "The amount is too small to give every person at least one cent." };
    lines = people.map((p, i) => ({ person: p.person, cents: parts[i] }));
  } else {
    lines = people.map((p) => ({ person: p.person, cents: p.cents ?? 0 }));
    if (lines.some((l) => l.cents <= 0)) return { ok: false, error: "Every person needs an amount above zero." };
  }
  const sharedCents = lines.reduce((s, l) => s + l.cents, 0);
  if (sharedCents > totalCents) return { ok: false, error: "The amounts add up to more than the total. Xenon's share cannot be negative." };
  return { ok: true, lines, sharedCents, instituteCents: totalCents - sharedCents };
}

export function parseCancelReason(raw: unknown): { ok: true; reason: string } | { ok: false; error: string } {
  const reason = text(raw);
  if (reason.length < CANCEL_REASON_MIN) return { ok: false, error: `Give a reason (at least ${CANCEL_REASON_MIN} characters).` };
  if (reason.length > CANCEL_REASON_MAX) return { ok: false, error: `The reason is too long (most ${CANCEL_REASON_MAX} characters).` };
  return { ok: true, reason };
}

/** The signed effect on a person's pay: a shared expense is MINUS, a bonus is PLUS. */
export const signedCents = (kind: AdjustmentKind, cents: number) => (kind === "SHARED_EXPENSE" ? -cents : cents);
