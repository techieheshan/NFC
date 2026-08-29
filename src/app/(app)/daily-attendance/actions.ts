"use server";

import { requireRole } from "@/lib/authz";
import { colomboNow } from "@/lib/colombo-time";
import { courseScopeFor, dailyAttendance, type DailyAttendance } from "@/lib/reports";

/**
 * All three roles may read this, but a TEACHER is narrowed to their own
 * courses — resolved from the database inside `courseScopeFor`, so the scope
 * cannot be widened by anything the client sends.
 */
export async function loadDailyAttendance(date: string): Promise<DailyAttendance> {
  const user = await requireRole(["ADMIN", "STAFF", "TEACHER"]);

  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : colomboNow().date;
  const scope = await courseScopeFor(user);

  return dailyAttendance(day, scope);
}
