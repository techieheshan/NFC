"use server";

import { z } from "zod";

import { buildMonthDetail, type MonthDetail } from "@/lib/payment-view";
import { findStudentByIdentifier } from "@/lib/students";

import { requirePaymentNewAction } from "./access";

/**
 * Read-only helpers for the new payment screens. Nothing here writes, and none of
 * it prices anything: charging still goes through the existing `takePayment`.
 *
 * Each is its own HTTP endpoint, so each re-checks the role (AGENTS rule 10) —
 * the page guard does not cover them. Both use the same role constant as the pages
 * (`PAYMENT_NEW_ROLES`, ADMIN + STAFF since the menu switch).
 */

/**
 * Turns a tapped card or a scanned QR into a student id, through the same
 * lookup (and the same card-id normalising) as the old screen — so the screen
 * can open that student's page.
 */
export async function identifyStudent(input: {
  cardUid?: string;
  cardNumber?: string;
}): Promise<{ studentId: number } | null> {
  await requirePaymentNewAction();
  const parsed = z
    .object({ cardUid: z.string().trim().max(100).optional(), cardNumber: z.string().trim().max(100).optional() })
    .safeParse(input);
  if (!parsed.success) return null;
  const student = await findStudentByIdentifier(parsed.data);
  return student ? { studentId: student.id } : null;
}

const monthInput = z.object({
  studentId: z.coerce.number().int().positive(),
  courseId: z.coerce.number().int().positive(),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

/** The attendance behind one month of one course, for the month-detail pop-up. */
export async function loadMonthDetail(input: {
  studentId: number;
  courseId: number;
  year: number;
  month: number;
}): Promise<MonthDetail | null> {
  await requirePaymentNewAction();
  const parsed = monthInput.safeParse(input);
  if (!parsed.success) return null;
  return buildMonthDetail(parsed.data);
}
