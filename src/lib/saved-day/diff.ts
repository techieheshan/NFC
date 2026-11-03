import { decimalToCents, formatCents } from "@/lib/cents";

import type { Snapshot } from "./snapshot";

/**
 * Saved vs live: what differs between a saved day and a fresh `dailySummary()`.
 *
 * Both sides come from the SAME function over the same half-open Colombo window, so a day edge cannot make them disagree by itself;
 * only a real change (a receipt cancelled, an expense added or corrected) does. Money is compared in INTEGER CENTS (so "76375" and
 * "76375.00" are equal), counts as integers. An absent optional figure counts as zero. Rows that exist on one side only and carry no
 * money and no count are not a difference (a course created after the day was saved).
 *
 * It compares every figure and flag the document prints AND the names it prints (course, teacher, staff, a deduction's person and
 * authoriser). The snapshot holds names only, never ids, so a pure RENAME in Setup cannot be told from a REASSIGNMENT (a deduction
 * moved from teacher A to teacher B, or a corrected authoriser); both are listed. A difference that is ONLY names is marked
 * `nameOnly`, so the screen can say "Some names differ from the saved day" instead of "The live numbers are different". The
 * registered and not-paid counts are not on the paper and are not compared.
 */

export type FigureDiff = { key: string; label: string; saved: string; live: string; /** The difference is in a printed NAME only, not in a number or a flag. */ nameOnly?: true };

const cents = (v: string | undefined) => decimalToCents(v ?? "0");

export function diffSummaries(saved: Snapshot, live: Snapshot): FigureDiff[] {
  const out: FigureDiff[] = [];
  const money = (key: string, label: string, a: string | undefined, b: string | undefined) => {
    if (cents(a) !== cents(b)) out.push({ key, label, saved: formatCents(cents(a)), live: formatCents(cents(b)) });
  };
  const num = (key: string, label: string, a: number | undefined, b: number | undefined) => {
    if ((a ?? 0) !== (b ?? 0)) out.push({ key, label, saved: String(a ?? 0), live: String(b ?? 0) });
  };

  const s = saved.report;
  const l = live.report;
  money("totalCollected", "Total collected", s.totalCollected, l.totalCollected);
  money("classTotal", "Class fees", s.classTotal, l.classTotal);
  num("admission.count", "Admissions", s.admission.count, l.admission.count);
  money("admission.total", "Admission", s.admission.total, l.admission.total);
  num("smartCard.count", "Smart cards", s.smartCard.count, l.smartCard.count);
  money("smartCard.total", "Smart card", s.smartCard.total, l.smartCard.total);
  num("halfMonths.count", "Half months", s.halfMonths?.count, l.halfMonths?.count);
  money("halfMonths.total", "Half months (amount)", s.halfMonths?.total, l.halfMonths?.total);
  num("noChargeMonths.count", "No-charge months", s.noChargeMonths?.count, l.noChargeMonths?.count);
  money("deductions.teacherAdvances", "Teacher advances", s.deductions.teacherAdvances, l.deductions.teacherAdvances);
  money("deductions.xenonExpenses", "Xenon expenses", s.deductions.xenonExpenses, l.deductions.xenonExpenses);
  money("deductions.total", "Deductions", s.deductions.total, l.deductions.total);
  money("net", "Net", s.net, l.net);
  num("cancelled.receipts", "Cancelled receipts", saved.cancelled.receipts, live.cancelled.receipts);
  money("cancelled.total", "Cancelled (not counted)", saved.cancelled.total, live.cancelled.total);

  // courses, matched by id; a missing row is the same as a row of zeros
  const byId = (rows: Snapshot["report"]["courses"]) => new Map(rows.map((r) => [r.courseId, r]));
  const sc = byId(s.courses);
  const lc = byId(l.courses);
  for (const id of [...new Set([...sc.keys(), ...lc.keys()])].sort((a, b) => a - b)) {
    const a = sc.get(id);
    const b = lc.get(id);
    const name = `${(b ?? a)!.course} (${(b ?? a)!.teacher})`;
    if (a && b) {
      // names are printed too: a course or teacher name that changed is listed (as names only)
      if (a.course !== b.course) out.push({ key: `course:${id}.name`, label: "Course name", saved: a.course, live: b.course, nameOnly: true });
      if (a.teacher !== b.teacher) out.push({ key: `course:${id}.teacher`, label: `${b.course}: teacher`, saved: a.teacher, live: b.teacher, nameOnly: true });
      // the reconcile flag is printed as a warning
      if (a.reconciles !== b.reconciles) out.push({ key: `course:${id}.reconciles`, label: `${name}: reconciles`, saved: a.reconciles ? "yes" : "no", live: b.reconciles ? "yes" : "no" });
    }
    money(`course:${id}.amount`, `${name}: amount`, a?.amount, b?.amount);
    num(`course:${id}.paidFull`, `${name}: full`, a?.paidFull, b?.paidFull);
    num(`course:${id}.paidHalf`, `${name}: half`, a?.paidHalf, b?.paidHalf);
    num(`course:${id}.paidQuarter`, `${name}: 25%`, a?.paidQuarter, b?.paidQuarter);
    num(`course:${id}.free`, `${name}: free`, a?.free, b?.free);
  }

  // deduction lines as a multiset of FIGURES (date, kind, reason, staff-advance flag, amount); who it was for and who authorised it is compared next
  type Line = Snapshot["report"]["deductionLines"][number];
  const lineKey = (d: Line) => JSON.stringify([d.date, d.kind, d.reason, d.isStaffAdvance, cents(d.amount)]);
  const who = (d: Line) => `${d.person ?? "—"}, authorised by ${d.authorizedBy}`;
  const tally = (rows: readonly Line[]) => {
    const m = new Map<string, { n: number; d: Line; who: string[] }>();
    for (const d of rows) {
      const k = lineKey(d);
      const cur = m.get(k) ?? { n: 0, d, who: [] };
      cur.n += 1;
      cur.who.push(who(d));
      m.set(k, cur);
    }
    return m;
  };
  const sd = tally(s.deductionLines);
  const ld = tally(l.deductionLines);
  for (const k of [...new Set([...sd.keys(), ...ld.keys()])].sort()) {
    const a = sd.get(k);
    const b = ld.get(k);
    const d = (b ?? a)!.d;
    const what = `${d.reason}${d.person ? ` (${d.person})` : ""}`;
    if ((a?.n ?? 0) !== (b?.n ?? 0)) {
      out.push({
        key: `deduction:${k}`,
        label: `Deduction: ${what}`,
        saved: (a?.n ?? 0) === 0 ? "none" : `${a!.n} × ${formatCents(cents(d.amount))}`,
        live: (b?.n ?? 0) === 0 ? "none" : `${b!.n} × ${formatCents(cents(d.amount))}`,
      });
    } else if (a && b) {
      const sw = [...a.who].sort().join("; ");
      const lw = [...b.who].sort().join("; ");
      if (sw !== lw) out.push({ key: `deduction-names:${k}`, label: `Deduction: ${d.reason}: who`, saved: sw, live: lw, nameOnly: true });
    }
  }

  // collected by staff, matched by user id
  const sr = new Map(saved.staff.map((r) => [r.userId, r]));
  const lr = new Map(live.staff.map((r) => [r.userId, r]));
  for (const id of [...new Set([...sr.keys(), ...lr.keys()])].sort()) {
    const a = sr.get(id);
    const b = lr.get(id);
    const name = (b ?? a)!.name;
    if (a && b && a.name !== b.name) out.push({ key: `staff:${id}.name`, label: "Staff name", saved: a.name, live: b.name, nameOnly: true });
    num(`staff:${id}.receipts`, `${name}: receipts`, a?.receipts, b?.receipts);
    money(`staff:${id}.collected`, `${name}: collected`, a?.collected, b?.collected);
  }
  return out;
}
