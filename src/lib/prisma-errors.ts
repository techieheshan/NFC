/**
 * Prisma's known-error classes aren't worth importing just to read a code, and
 * duck-typing keeps this working across client-generator changes.
 *
 * P2002 = unique constraint violation.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
