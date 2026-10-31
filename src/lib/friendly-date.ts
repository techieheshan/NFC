const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "2026-08-08" → "8 Aug 2026". Pure string work on the calendar date (no `Date`, so no timezone
 * can move the day). Anything that is not a plain YYYY-MM-DD comes back unchanged, so a screen
 * never shows "NaN Undefined".
 */
export function friendlyDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return iso;
  return `${day} ${MONTHS[month - 1]} ${m[1]}`;
}
