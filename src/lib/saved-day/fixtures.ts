import type { DailySummary } from "@/lib/reports";

import { buildSnapshot, type Snapshot } from "./snapshot";

/** Made-up data for the saved-day tests. Never real names or amounts. */
export function summaryOf(over: Partial<DailySummary> = {}): DailySummary {
  return {
    from: "2026-10-14",
    to: "2026-10-14",
    courses: [
      { courseId: 1, course: "Physics 2027", teacher: "Mr A", registered: 20, paidFull: 8, paidHalf: 1, paidQuarter: 1, notPaid: 9, free: 1, amount: "24500.00", reconciles: true },
      { courseId: 2, course: "ICT Theory", teacher: "Ms B", registered: 12, paidFull: 3, paidHalf: 0, paidQuarter: 0, notPaid: 9, free: 0, amount: "7500.00", reconciles: true },
    ],
    admission: { count: 2, total: "2600.00" },
    smartCard: { count: 1, total: "500.00" },
    classTotal: "32000.00",
    totalCollected: "35100.00",
    deductions: { teacherAdvances: "5000.00", xenonExpenses: "1200.00", total: "6200.00" },
    deductionLines: [
      { date: "2026-10-14", kind: "TEACHER_ADVANCE", person: "Mr A", reason: "Advance", authorizedBy: "Admin One", isStaffAdvance: false, amount: "5000.00" },
      { date: "2026-10-14", kind: "XENON", person: null, reason: "Paper", authorizedBy: "Admin One", isStaffAdvance: false, amount: "1200.00" },
    ],
    net: "28900.00",
    ...over,
  };
}

export function snapshotOf(over: { report?: Partial<DailySummary>; cancelled?: Snapshot["cancelled"]; staff?: Snapshot["staff"] } = {}): Snapshot {
  return buildSnapshot({
    report: summaryOf(over.report),
    cancelled: over.cancelled ?? { receipts: 0, total: "0.00" },
    staff: over.staff ?? [
      { userId: "u1", name: "Sadun", receipts: 6, collected: "20100.00" },
      { userId: "u2", name: "Thilini", receipts: 4, collected: "15000.00" },
    ],
  });
}
