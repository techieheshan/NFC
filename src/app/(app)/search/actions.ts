"use server";

import { requireOperationalAccess } from "@/lib/authz";
import { findStudentByIdentifier, type StudentBrief } from "@/lib/students";

/**
 * Resolve a tapped or scanned card to a student, for the profile front door.
 *
 * Read-only, and guarded like every other read here: an open card-to-student
 * endpoint would let anyone turn a stolen card into a name. Normalisation is
 * `findStudentByIdentifier`'s job, so a typed number and a scanned one land on
 * the same row (AGENTS.md rule 12).
 */
export async function resolveCard(input: {
  cardUid?: string;
  cardNumber?: string;
}): Promise<StudentBrief | null> {
  await requireOperationalAccess();
  return findStudentByIdentifier(input);
}
