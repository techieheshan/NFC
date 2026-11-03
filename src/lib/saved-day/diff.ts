import { decimalToCents, formatCents } from "@/lib/cents";

import type { Snapshot } from "./snapshot";

/**
 * Saved vs live: which figures of a saved day differ from a fresh `dailySummary()`.
 *
 * Both sides come from the SAME function over the same half-open Colombo window, so a day edge cannot make them disagree by itself;
 * only a real change (a receipt cancelled, an expense added) does. Money is compared in INTEGER CENTS (so "76375" and "76375.00" are
 * equal), counts as integers, names and reasons as text. An absent optional figure counts as zero. It compares EVERYTHING the A4
 * document prints (including the reconcile flag of a course, course, teacher and staff names, and whether a deduction is a staff advance);
 * the registered and not-paid counts are not on the paper and are not compared. Rows that exist on one side only
 * and carry no money and no count are not a difference (a course created after the day was saved).
 */

export type FigureDiff = { key: string; label: string; saved: string; live: string };

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
      // everything the document prints about a course that exists on both sides
      if (a.course !== b.course) out.push({ key: `course:${id}.name`, label: "Course name", saved: a.course, live: b.course });
      if (a.teacher !== b.teacher) out.push({ key: `course:${id}.teacher`, label: `${b.course}: teacher`, saved: a.teacher, live: b.teacher });
      if (a.reconciles !== b.reconciles) out.push({ key: `course:${id}.reconciles`, label: `${name}: reconciles`, saved: a.reconciles ? "yes" : "no", live: b.reconciles ? "yes" : "no" });
    }
    money(`course:${id}.amount`, `${name}: amount`, a?.amount, b?.amount);
    num(`course:${id}.paidFull`, `${name}: full`, a?.paidFull, b?.paidFull);
    num(`course:${id}.paidHalf`, `${name}: half`, a?.paidHalf, b?.paidHalf);
    num(`course:${id}.paidQuarter`, `${name}: 25%`, a?.paidQuarter, b?.paidQuarter);
    num(`course:${id}.free`, `${name}: free`, a?.free, b?.free);
  }

  // deduction lines as a multiset
  const lineKey = (d: Snapshot["report"]["deductionLines"][number]) =>
    JSON.stringify([d.date, d.kind, d.person, d.reason, d.authorizedBy, d.isStaffAdvance, cents(d.amount)]);
  const tally = (rows: Snapshot["report"]["deductionLines"]) => {
    const m = new Map<string, { n: number; d: Snapshot["report"]["deductionLines"][number] }>();
    for (const d of rows) m.set(lineKey(d), { n: (m.get(lineKey(d))?.n ?? 0) + 1, d });
    return m;
  };
  const sd = tally(s.deductionLines);
  const ld = tally(l.deductionLines);
  for (const k of [...new Set([...sd.keys(), ...ld.keys()])].sort()) {
    const a = sd.get(k);
    const b = ld.get(k);
    if ((a?.n ?? 0) === (b?.n ?? 0)) continue;
    const d = (b ?? a)!.d;
    const what = `${d.reason}${d.person ? ` (${d.person})` : ""}`;
    out.push({
      key: `deduction:${k}`,
      label: `Deduction: ${what}`,
      saved: (a?.n ?? 0) === 0 ? "none" : `${a!.n} × ${formatCents(cents(d.amount))}`,
      live: (b?.n ?? 0) === 0 ? "none" : `${b!.n} × ${formatCents(cents(d.amount))}`,
    });
  }

  // collected by staff, matched by user id
  const sr = new Map(saved.staff.map((r) => [r.userId, r]));
  const lr = new Map(live.staff.map((r) => [r.userId, r]));
  for (const id of [...new Set([...sr.keys(), ...lr.keys()])].sort()) {
    const a = sr.get(id);
    const b = lr.get(id);
    if (a && b && a.name !== b.name) out.push({ key: `staff:${id}.name`, label: "Staff name", saved: a.name, live: b.name });
    const name = (b ?? a)!.name;
    num(`staff:${id}.receipts`, `${name}: receipts`, a?.receipts, b?.receipts);
    money(`staff:${id}.collected`, `${name}: collected`, a?.collected, b?.collected);
  }
  return out;
}
