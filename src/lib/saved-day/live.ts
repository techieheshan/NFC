import type { CancelledSummary } from "@/lib/daily-summary-extras";
import type { StaffCollected } from "@/lib/daily-summary-rows";
import type { DailySummary } from "@/lib/reports";

import { buildSnapshot, SnapshotError, type Snapshot } from "./snapshot";

/**
 * The live numbers a day page has ALREADY loaded (`loadDayBundle`), shaped as a snapshot so a saved day can be compared with them
 * without reading them a second time. `null` when they do not fit the snapshot shape: the page then says so instead of comparing.
 */
export function liveFromBundle(b: { report: DailySummary; cancelled: CancelledSummary; staff: readonly StaffCollected[] }): Snapshot | null {
  try {
    return buildSnapshot({ report: b.report, cancelled: b.cancelled, staff: b.staff });
  } catch (e) {
    if (e instanceof SnapshotError) return null;
    throw e;
  }
}
