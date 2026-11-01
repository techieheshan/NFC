/**
 * Who may sign a Daily Summary (AGENTS rule 24).
 *
 *   Prepared by — any active ADMIN or STAFF account (whoever banks the money prepares the summary).
 *   Checked by  — active ADMIN accounts ONLY. Nothing else in the Daily Summary is admin-only.
 *
 * Pure, so the rule can be tested against any set of accounts; `listSigners` (the server action) feeds it
 * the active ADMIN/STAFF rows, and the document route resolves the ids it is given against the SAME
 * lists — an id in the URL is never trusted, only looked up here.
 */
export type Signer = { id: string; name: string; role: "ADMIN" | "STAFF" };

export type SignerUser = {
  id: string;
  username: string;
  role: string;
  staff?: { name: string } | null;
};

export function splitSigners(users: readonly SignerUser[]): { prepared: Signer[]; checked: Signer[] } {
  const all: Signer[] = users
    .filter((u) => u.role === "ADMIN" || u.role === "STAFF")
    .map((u) => ({ id: u.id, name: u.staff?.name ?? u.username, role: u.role as "ADMIN" | "STAFF" }));
  return { prepared: all, checked: all.filter((u) => u.role === "ADMIN") };
}

/** The signer with this id in THIS list, or null: a hostile, repeated or stale id resolves to nobody. */
export function pickSigner(list: readonly Signer[], id: unknown): Signer | null {
  if (typeof id !== "string" || id === "") return null;
  return list.find((s) => s.id === id) ?? null;
}
