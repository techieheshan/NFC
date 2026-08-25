/**
 * Card UIDs reach us from two places that format them differently: Web NFC
 * returns `event.serialNumber` as colon-separated lowercase hex ("04:a2:2b:9c"),
 * while staff typing a UID by hand may use spaces, dashes, or nothing at all.
 *
 * `Student.cardUid` is UNIQUE, so both paths must land on the same string or a
 * known card would look new. Everything is normalised to bare uppercase.
 */
export function normalizeCardUid(raw: string): string {
  return raw.trim().replace(/[\s:-]/g, "").toUpperCase();
}

/** Grouped back into pairs for display: "04A22B9C" -> "04:A2:2B:9C". */
export function formatCardUid(uid: string): string {
  return uid.match(/.{1,2}/g)?.join(":") ?? uid;
}
