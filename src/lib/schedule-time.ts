import type { DayOfWeek } from "@prisma/client";

/**
 * Times of day are "HH:mm" strings (schema rule 4). Zero-padded 24h means
 * lexicographic comparison is also chronological comparison, which is why
 * `endTime > startTime` can be a plain string compare.
 */
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTime(value: string): boolean {
  return TIME_PATTERN.test(value);
}

/** Days in week order. Matches the DayOfWeek enum's declaration order. */
export const DAYS: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export const DAY_LABEL: Record<DayOfWeek, string> = {
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THU: "Thursday",
  FRI: "Friday",
  SAT: "Saturday",
  SUN: "Sunday",
};

export const DAY_SHORT: Record<DayOfWeek, string> = {
  MON: "Mon",
  TUE: "Tue",
  WED: "Wed",
  THU: "Thu",
  FRI: "Fri",
  SAT: "Sat",
  SUN: "Sun",
};

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function fromMinutes(total: number): string {
  // Clamp into the day: a window that would open before midnight shows 00:00
  // rather than wrapping to the previous evening.
  const clamped = Math.max(0, Math.min(24 * 60 - 1, total));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * The attendance window this row describes, for display only.
 *
 *   opens  = startTime - attendanceOpensBeforeMin
 *   closes = endTime   - attendanceClosesBeforeMin
 *
 * Note `closes` counts back from the END of the class, not the start — a 3:00–5:00
 * class with closesBefore = 30 stops accepting marks at 4:30. The Attendance tag
 * is what actually evaluates this; here it is only stored and shown.
 */
export function attendanceWindow(row: {
  startTime: string;
  endTime: string;
  attendanceOpensBeforeMin: number;
  attendanceClosesBeforeMin: number;
}): { opens: string; closes: string } {
  return {
    opens: fromMinutes(toMinutes(row.startTime) - row.attendanceOpensBeforeMin),
    closes: fromMinutes(toMinutes(row.endTime) - row.attendanceClosesBeforeMin),
  };
}

/** "14:30" -> "2:30 PM", for read-only display. */
export function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}
