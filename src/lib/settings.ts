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

/**
 * The editable configuration, described in one place.
 *
 * The Settings screen renders this list; nothing about the institute is
 * hardcoded anywhere else. `kind` drives both the input and the server-side
 * validation, so a new key is one entry here rather than a new form.
 */
export type SettingKind = "money" | "percent-list" | "toggle";

export type SettingSpec = {
  key: string;
  label: string;
  help: string;
  kind: SettingKind;
  /** Used when the row does not exist yet. */
  fallback: string;
};

export const SETTING_SPECS: SettingSpec[] = [
  {
    key: "admission_fee",
    label: "Admission fee",
    help: "Charged once per student. Changing it affects future payments only — receipts already taken keep the amount they were taken at.",
    kind: "money",
    fallback: "0",
  },
  {
    key: "smart_card_fee",
    label: "Smart card fee",
    help: "Charged when a card is issued or reissued. Future payments only.",
    kind: "money",
    fallback: "0",
  },
  {
    key: "default_institute_fee",
    label: "Default institute fee",
    help: "Pre-filled when creating a course. Existing courses keep their own value.",
    kind: "money",
    fallback: "0",
  },
  {
    key: "institute_share_presets",
    label: "Institute share presets",
    help: "The percentages offered as one-click choices on the course form, comma separated (e.g. 20,25,30).",
    kind: "percent-list",
    fallback: "",
  },
  {
    key: "voice_confirmations",
    label: "Voice confirmations",
    help: "Speak short English confirmations at the counter, on top of the tones. Tones always play.",
    kind: "toggle",
    fallback: "on",
  },
  {
    key: "roster_show_phone",
    label: "Show phone numbers on My Students",
    help: "Whether a teacher sees student/parent phone numbers on their class roster, and in its PDF.",
    kind: "toggle",
    fallback: "on",
  },
];

/** A toggle's value, with the spec's default when the row is absent. */
export async function getToggle(key: string): Promise<boolean> {
  const spec = SETTING_SPECS.find((s) => s.key === key);
  const raw = (await getSetting(key)) ?? spec?.fallback ?? "off";
  return raw === "on";
}

/** Every spec with its current value — what the Settings screen renders. */
export async function getAllSettings(): Promise<(SettingSpec & { value: string })[]> {
  const rows = await db.setting.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  return SETTING_SPECS.map((spec) => ({ ...spec, value: byKey.get(spec.key) ?? spec.fallback }));
}
