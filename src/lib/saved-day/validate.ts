import { z } from "zod";

import { MAX_BANK_LINES, isClockTime, type BankLine } from "@/lib/cash-flow";
import { MAX_CENTS, parseTypedAmount } from "@/lib/cents";
import { parseRealDate } from "@/lib/daily-summary-dates";

/**
 * Everything a save action receives is hostile input. This reads it with the SAME rules as Release 1's typed state (an amount is
 * digits with optional commas and up to 2 decimals, never negative, never above 99,999,999.99; a bank line needs a real HH:MM and a
 * positive amount; at most 10 lines; slip and note are cleaned of control characters and cut to length), and turns it into integer
 * cents. On a refusal it returns the sanitised `values` it was given so the form can show them again (rule 14).
 */

export const SLIP_MAX = 30;
export const NOTE_MAX = 80;

const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

const rawSchema = z.object({
  date: z.string().max(10),
  mode: z.enum(["save", "edit", "resave"]),
  baseVersion: z.number().int().min(0).max(1_000_000),
  doneById: z.string().max(64),
  bringForward: z.string().max(20).default(""),
  bank: z.array(z.object({ time: z.string().max(5), amount: z.string().max(20), slip: z.string().max(300), note: z.string().max(600) })).max(50).default([]),
  seen: z.object({ collected: z.number().int().min(-MAX_CENTS * 10).max(MAX_CENTS * 10), deductions: z.number().int().min(-MAX_CENTS * 10).max(MAX_CENTS * 10) }).optional(),
});

export type SaveMode = "save" | "edit" | "resave";

export type SaveValues = {
  date: string;
  mode: string;
  baseVersion: number | null;
  doneById: string;
  bringForward: string;
  bank: { time: string; amount: string; slip: string; note: string }[];
};

export type ParsedSave = {
  date: string;
  mode: SaveMode;
  baseVersion: number;
  doneById: string;
  bringForwardCents: number;
  bank: BankLine[];
  /** What the sheet showed, in cents. Only a stale check: never stored. */
  seen: { collected: number; deductions: number } | null;
};

export type SaveParse =
  | { ok: true; value: ParsedSave }
  | { ok: false; message: string; fieldErrors: Record<string, string>; values: SaveValues };

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");

/** The text fields of whatever arrived, safe to send back. */
export function echoValues(raw: unknown): SaveValues {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const bank = Array.isArray(o.bank) ? o.bank.slice(0, 50) : [];
  return {
    date: str(o.date, 10),
    mode: str(o.mode, 10),
    baseVersion: typeof o.baseVersion === "number" && Number.isInteger(o.baseVersion) ? o.baseVersion : null,
    doneById: str(o.doneById, 64),
    bringForward: str(o.bringForward, 20),
    bank: bank.map((b) => {
      const x = (typeof b === "object" && b !== null ? b : {}) as Record<string, unknown>;
      return { time: str(x.time, 5), amount: str(x.amount, 20), slip: str(x.slip, SLIP_MAX), note: str(x.note, NOTE_MAX) };
    }),
  };
}

export function parseSaveInput(raw: unknown): SaveParse {
  const values = echoValues(raw);
  const fail = (message: string, fieldErrors: Record<string, string> = {}): SaveParse => ({ ok: false, message, fieldErrors, values });

  const shape = rawSchema.safeParse(raw);
  if (!shape.success) {
    const path = shape.error.issues[0]?.path.join(".") || "input";
    return fail("That could not be read. Reload the page and try again.", { [path]: "Not valid." });
  }
  const r = shape.data;

  const date = parseRealDate(r.date);
  if (date === null) return fail("Choose a real date.", { date: "Not a real date." });
  if (r.doneById.trim() === "") return fail("Choose who did this (Done by).", { doneById: "Choose Done by." });

  let bringForwardCents = 0;
  if (r.bringForward.trim() !== "") {
    const bf = parseTypedAmount(r.bringForward);
    if (!bf.ok) return fail("The bring-forward is not a valid amount.", { bringForward: "Not a valid amount." });
    bringForwardCents = bf.cents;
  }

  if (r.bank.length > MAX_BANK_LINES) return fail(`At most ${MAX_BANK_LINES} bank deposits.`, { bank: `At most ${MAX_BANK_LINES}.` });
  const bank: BankLine[] = [];
  for (let i = 0; i < r.bank.length; i++) {
    const b = r.bank[i];
    const amount = parseTypedAmount(b.amount);
    if (!isClockTime(b.time)) return fail("A bank deposit needs a real time (HH:MM).", { [`bank.${i}.time`]: "Not a time." });
    if (!amount.ok || amount.cents < 1) return fail("A bank deposit needs an amount above zero.", { [`bank.${i}.amount`]: "Not a valid amount." });
    bank.push({ cents: amount.cents, time: b.time, slip: clean(b.slip, SLIP_MAX), note: clean(b.note, NOTE_MAX) });
  }

  if (r.mode !== "edit" && !r.seen) return fail("The numbers you were shown are missing. Reload the page and try again.", { seen: "Missing." });

  return {
    ok: true,
    value: { date, mode: r.mode, baseVersion: r.baseVersion, doneById: r.doneById, bringForwardCents, bank, seen: r.seen ?? null },
  };
}
