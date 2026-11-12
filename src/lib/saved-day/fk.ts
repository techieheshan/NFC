import { Prisma } from "@prisma/client";

/**
 * Which column's foreign key failed (`doneById`, `savedById`, `checkedById`…), read from the constraint name `DailySummary<Table>_<column>_fkey` that the
 * error carries (in its message, and in `meta` under a driver adapter); null when it cannot be told or the error is not a Prisma one. Pure, so each
 * shape of error is tested without a database.
 */
export function fkColumn(e: unknown): string | null {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return null;
  let text = e.message;
  try {
    text += ` ${JSON.stringify(e.meta ?? {})}`;
  } catch {
    // meta that cannot be serialised must not replace the real error
  }
  return /DailySummary[A-Za-z]+_([A-Za-z]+)_fkey/.exec(text)?.[1] ?? null;
}

/** What a foreign-key failure on a SAVE means for the person: their own session user is gone, the Done by they chose is gone, or something else (never blamed on the person). */
export function saveFkKind(column: string | null): "session" | "done-by" | "other" {
  return column === "savedById" ? "session" : column === "doneById" ? "done-by" : "other";
}

/** The same for a CHECK: the person tapping (the session user), the admin they named, or something else. */
export function checkFkKind(column: string | null): "session" | "named-admin" | "other" {
  return column === "markedById" ? "session" : column === "checkedById" ? "named-admin" : "other";
}
