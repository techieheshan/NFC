import type { DayOfWeek } from "@prisma/client";

/**
 * All "now" logic for attendance is in Asia/Colombo, never the server's clock.
 *
 * The server runs UTC in production, so a 8–10 PM Colombo class would otherwise
 * resolve against the previous UTC day and land outside its window. Everything
 * here derives the wall-clock date/time/weekday through `Intl` rather than by
 * adding a fixed offset — no DST assumptions, no drift if the zone ever changes.
 */
export const INSTITUTE_TZ = "Asia/Colombo";

const WEEKDAY_TO_ENUM: Record<string, DayOfWeek> = {
  Mon: "MON",
  Tue: "TUE",
  Wed: "WED",
  Thu: "THU",
  Fri: "FRI",
  Sat: "SAT",
  Sun: "SUN",
};

const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: INSTITUTE_TZ,
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export type ColomboNow = {
  /** "YYYY-MM-DD" — the calendar day in Colombo. */
  date: string;
  /** "HH:mm" 24h — comparable directly against Schedule.startTime/endTime. */
  time: string;
  dayOfWeek: DayOfWeek;
};

export function colomboNow(at: Date = new Date()): ColomboNow {
  const parts = formatter.formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  // `en-GB` renders midnight as "24" in some ICU versions; normalise it.
  const hour = get("hour") === "24" ? "00" : get("hour");

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hour}:${get("minute")}`,
    dayOfWeek: WEEKDAY_TO_ENUM[get("weekday")],
  };
}

/**
 * The Colombo calendar day as a `@db.Date` value.
 *
 * Stored at UTC midnight so the DATE column holds exactly the day staff saw,
 * matching how AdditionalClass.date is written.
 */
export function colomboDateValue(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** "14:30" -> "2:30 PM", for the messages staff read. */
export function to12Hour(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * Minutes Colombo is ahead of UTC at a given instant, derived rather than
 * hardcoded so the code survives any future zone change.
 */
function colomboOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: INSTITUTE_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === t)?.value ?? "0");
  const hour = get("hour") === 24 ? 0 : get("hour");
  const asIfUtc = Date.UTC(
    get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"),
  );
  return (asIfUtc - at.getTime()) / 60000;
}

/**
 * The UTC instant at which a Colombo calendar day begins.
 *
 * `Payment.paidAt` and `Attendance.markedAt` are timestamps, so filtering "money
 * collected on the 26th" needs real instants — not the DATE-column trick used
 * for `Attendance.date`. Colombo midnight is 18:30 UTC the day before.
 */
export function colomboDayStartUtc(date: string): Date {
  const guess = new Date(`${date}T00:00:00.000Z`);
  return new Date(guess.getTime() - colomboOffsetMinutes(guess) * 60000);
}

/** Half-open [start of `from`, start of the day after `to`) in UTC instants. */
export function colomboRangeUtc(from: string, to: string): { gte: Date; lt: Date } {
  const after = new Date(`${to}T00:00:00.000Z`);
  after.setUTCDate(after.getUTCDate() + 1);
  return {
    gte: colomboDayStartUtc(from),
    lt: colomboDayStartUtc(after.toISOString().slice(0, 10)),
  };
}

/** The Colombo calendar day after `date`, as "YYYY-MM-DD". */
export function colomboNextDay(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
