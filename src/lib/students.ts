import "server-only";

import { normalizeCardNumber, normalizeCardUid } from "@/lib/card-uid";
import { db } from "@/lib/db";

/** Just enough to show a student on a scan panel. */
export type StudentBrief = {
  id: number;
  name: string;
  school: string | null;
  cardNumber: string | null;
  photoUrl: string | null;
};

export const studentBriefSelect = {
  id: true,
  name: true,
  school: true,
  cardNumber: true,
  photoUrl: true,
} as const;

/**
 * Typeahead over card number, name and school.
 *
 * Shared so Attendance and Payment behave identically: staff type a fragment of
 * the changing part of a card number ("2000"), or a name, or a school. Callers
 * must apply their own role guard — this is a plain query, not an action.
 */
export function searchStudentsQuery(query: string): Promise<StudentBrief[]> {
  const q = query.trim();
  if (q.length < 2) return Promise.resolve([]);

  return db.student.findMany({
    where: {
      OR: [
        { cardNumber: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { school: { contains: q, mode: "insensitive" } },
      ],
    },
    select: studentBriefSelect,
    orderBy: { name: "asc" },
    take: 10,
  });
}

/** Resolve a scanned identifier to a student id. */
export async function findStudentByIdentifier(input: {
  cardUid?: string;
  cardNumber?: string;
  studentId?: number;
}): Promise<StudentBrief | null> {
  if (input.studentId !== undefined) {
    return db.student.findUnique({
      where: { id: input.studentId },
      select: studentBriefSelect,
    });
  }
  if (input.cardUid) {
    return db.student.findUnique({
      where: { cardUid: normalizeCardUid(input.cardUid) },
      select: studentBriefSelect,
    });
  }
  if (input.cardNumber) {
    return db.student.findUnique({
      where: { cardNumber: normalizeCardNumber(input.cardNumber) },
      select: studentBriefSelect,
    });
  }
  return null;
}
