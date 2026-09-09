import "server-only";

import { db } from "@/lib/db";

/**
 * Stream → Subject, the single source the registration cascade reads.
 *
 * A stream offers many subjects and a subject belongs to many streams (ICT is
 * both an A/L Tech and an A/L Arts subject), so this is a plain many-to-many.
 * GRADE is deliberately not part of it: a student may sit in another grade's
 * class to catch up, so grade stays data on the Course and never a filter.
 *
 * Registration narrows stream → subject → course through these three helpers
 * and nothing else, so what staff can pick can never disagree with what Setup
 * says a stream contains.
 */

export type SubjectOption = { id: number; label: string };

/** The subjects a stream offers. Active only — a retired subject is not offered. */
export function subjectsForStream(streamId: number): Promise<SubjectOption[]> {
  return db.subject.findMany({
    where: { active: true, streams: { some: { id: streamId } } },
    select: { id: true, label: true },
    orderBy: { label: "asc" },
  });
}

/**
 * The courses that teach one subject, optionally narrowed to a stream.
 *
 * The stream clause is optional because registration has an "any course"
 * escape: a student catching up needs a course outside their stream's usual
 * set, and refusing that would send staff to the database.
 */
export function coursesForSubject(subjectId: number, streamId?: number) {
  return db.course.findMany({
    where: { active: true, subjectId, ...(streamId ? { streamId } : {}) },
    select: {
      id: true, name: true, defaultFee: true,
      teacher: { select: { name: true } },
      grade: { select: { label: true } },
      subject: { select: { label: true } },
      classType: { select: { label: true } },
    },
    orderBy: { id: "asc" },
  });
}

/** Every stream with its subject links, for the Setup screen. */
export function streamsWithSubjects() {
  return db.stream.findMany({
    select: {
      id: true, label: true, active: true,
      subjects: { select: { id: true, label: true }, orderBy: { label: "asc" } },
    },
    orderBy: [{ active: "desc" }, { label: "asc" }],
  });
}
