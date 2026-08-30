import { to12Hour } from "@/lib/colombo-time";

/**
 * The attendance matcher, as a pure function of (today's classes, the clock).
 *
 * Deliberately NOT server-only: the same code runs on the server during a
 * normal scan and in the browser when the router is down. Two implementations
 * of "which class is open right now" would drift, and the offline one would
 * drift silently — nobody is watching a terminal in a blackout.
 *
 * Everything here is string comparison on zero-padded "HH:mm", which is
 * chronological (see schedule-time.ts), so there is no Date arithmetic and no
 * timezone in this file at all. The caller supplies the Colombo time.
 */

export type Candidate = {
  key: string;
  kind: "regular" | "additional";
  courseId: number;
  additionalClassId: number | null;
  course: string;
  teacher: string;
  startTime: string;
  endTime: string;
  opens: string;
  closes: string;
  /** "HH:mm" if this class is already marked for the student today. */
  markedAt: string | null;
};

export type MatchDecision =
  | { kind: "no-class" }
  | { kind: "outside"; message: string }
  | { kind: "already"; candidate: Candidate; at: string }
  | { kind: "confirm"; candidate: Candidate }
  | { kind: "mark"; candidate: Candidate }
  | { kind: "choose"; candidates: Candidate[] };

/**
 * Why is nothing open? Answer with the class staff are most likely asking
 * about: the next one to open if all are still ahead, otherwise the one that
 * closed most recently.
 */
export function outsideMessage(all: Candidate[], now: string): string {
  const upcoming = all
    .filter((c) => now < c.opens)
    .sort((a, b) => a.opens.localeCompare(b.opens))[0];
  if (upcoming) {
    return `${upcoming.course} — attendance opens at ${to12Hour(upcoming.opens)}`;
  }

  const closed = all
    .filter((c) => now > c.closes)
    .sort((a, b) => b.closes.localeCompare(a.closes))[0];
  if (closed) {
    return `${closed.course} — attendance closed at ${to12Hour(closed.closes)}`;
  }

  return "No class open right now.";
}

export const candidateKey = (c: { courseId: number; additionalClassId: number | null }) =>
  `${c.courseId}:${c.additionalClassId ?? ""}`;

/**
 * One class open and unmarked → mark it. An additional class is unusual enough
 * that staff acknowledge it first. Several open → they pick.
 */
export function matchCandidates(all: Candidate[], nowTime: string): MatchDecision {
  if (all.length === 0) return { kind: "no-class" };

  const open = all.filter((c) => nowTime >= c.opens && nowTime <= c.closes);
  if (open.length === 0) return { kind: "outside", message: outsideMessage(all, nowTime) };

  if (open.length === 1) {
    const candidate = open[0];
    if (candidate.markedAt) return { kind: "already", candidate, at: candidate.markedAt };
    if (candidate.kind === "additional") return { kind: "confirm", candidate };
    return { kind: "mark", candidate };
  }

  return { kind: "choose", candidates: open };
}
