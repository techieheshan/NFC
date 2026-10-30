import test from "node:test";
import assert from "node:assert/strict";

import { agendaFor } from "@/lib/timetable-agenda";
import type { TimetableReport } from "@/lib/report-timetable";

const hall = (id: number, name: string) => ({ id, name, icon: "door" });
const cls = (
  key: string, course: string, start: string, end: string,
  h: ReturnType<typeof hall> | null, extra: Partial<{ kind: "SCHEDULE" | "ADDITIONAL"; overridden: boolean }> = {},
) => ({
  key, kind: extra.kind ?? "SCHEDULE", id: 1, courseId: 1, course, teacher: "T", teacherId: 1,
  startTime: start, endTime: end, hall: h, defaultHall: h, overridden: extra.overridden ?? false,
});

// Sun, Mon, Tue — a short week is enough to prove the regrouping.
const days = [
  { date: "2026-10-25", day: "SUN", label: "Sunday" },
  { date: "2026-10-26", day: "MON", label: "Monday" },
  { date: "2026-10-27", day: "TUE", label: "Tuesday" },
];
const A = hall(1, "Hall A");
const B = hall(2, "Hall B");

const report = {
  from: "2026-10-25", to: "2026-10-27", days, total: 5,
  rows: [
    { hall: A, total: 2, cells: [[cls("s1", "Physics", "15:00", "17:00", A)], [], [cls("s2", "Maths", "08:00", "10:00", A)]] },
    { hall: B, total: 2, cells: [[cls("s3", "Chemistry", "08:00", "10:00", B, { overridden: true })], [], [cls("a1", "Extra ICT", "08:00", "09:00", B, { kind: "ADDITIONAL" })]] },
  ],
  unassigned: { hall: null, total: 1, cells: [[], [cls("s4", "Biology", "12:00", "13:00", null)], []] },
} as unknown as TimetableReport;

test("one section per day, in the report's own order, empty days kept", () => {
  const agenda = agendaFor(report);
  assert.deepEqual(agenda.map((d) => d.label), ["Sunday", "Monday", "Tuesday"]);
  assert.deepEqual(agenda.map((d) => d.entries.length), [2, 1, 2]);
});

test("classes from every hall land under their day, sorted by start time", () => {
  const sunday = agendaFor(report)[0].entries;
  assert.deepEqual(sunday.map((e) => e.course), ["Chemistry", "Physics"]); // 08:00 before 15:00
});

test("same start time breaks the tie by end time, then course name", () => {
  const tuesday = agendaFor(report)[2].entries;
  assert.deepEqual(tuesday.map((e) => e.course), ["Extra ICT", "Maths"]); // 08:00–09:00 before 08:00–10:00
});

test("a class with no hall is kept and shows no hall, not dropped", () => {
  const monday = agendaFor(report)[1].entries;
  assert.equal(monday.length, 1);
  assert.equal(monday[0].hall, null);
});

test("additional classes are told apart from the weekly timetable", () => {
  const tuesday = agendaFor(report)[2].entries;
  assert.equal(tuesday.find((e) => e.course === "Extra ICT")?.additional, true);
  assert.equal(tuesday.find((e) => e.course === "Maths")?.additional, false);
});

test("a one-day hall move is carried through exactly as the grid has it", () => {
  const chem = agendaFor(report)[0].entries.find((e) => e.course === "Chemistry");
  assert.equal(chem?.overridden, true);
  assert.equal(chem?.hall?.name, "Hall B");
});

test("every class in the grid appears in the agenda exactly once", () => {
  const gridTotal = [...report.rows, report.unassigned!].reduce(
    (n, r) => n + r.cells.reduce((m, list) => m + list.length, 0), 0);
  assert.equal(agendaFor(report).reduce((n, d) => n + d.entries.length, 0), gridTotal);
});
