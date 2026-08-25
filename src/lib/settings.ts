import "server-only";

import { db } from "@/lib/db";

/**
 * Reads a `Setting` row. Business values live in the database so the institute
 * can change them without a deploy — never inline them as constants.
 */
export async function getSetting(key: string): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

/**
 * Institute-share percentage presets, parsed from the `institute_share_presets`
 * Setting (stored as e.g. "20,25,30").
 *
 * Returns [] if the row is missing or unparseable rather than substituting a
 * default — the Course form then offers "Custom" only, which is honest about
 * the missing configuration instead of inventing numbers the institute never
 * chose.
 */
export async function getInstituteSharePresets(): Promise<number[]> {
  const raw = await getSetting("institute_share_presets");
  if (!raw) return [];

  const seen = new Set<number>();
  for (const part of raw.split(",")) {
    const n = Number(part.trim());
    if (Number.isFinite(n) && n >= 0 && n <= 100) seen.add(n);
  }

  return [...seen].sort((a, b) => a - b);
}
