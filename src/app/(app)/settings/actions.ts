"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireRole } from "@/lib/authz";
import { db } from "@/lib/db";
import { SETTING_SPECS } from "@/lib/settings";

const PATH = "/settings";

export type ActionState = {
  ok: boolean;
  error?: string;
  savedKey?: string;
  values?: Record<string, string>;
};

/**
 * Editing the institute's configuration is ADMIN only — on the action, not just
 * the menu. A server action is its own HTTP endpoint.
 *
 * Values are validated by their spec's `kind`, so adding a key to SETTING_SPECS
 * gets validation for free and there is nowhere to forget it.
 */
export async function saveSetting(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["ADMIN"]);

  const key = String(formData.get("key") ?? "");
  const raw = String(formData.get("value") ?? "").trim();
  const spec = SETTING_SPECS.find((s) => s.key === key);
  if (!spec) return { ok: false, error: "Unknown setting." };

  const echo = { [key]: raw };

  if (spec.kind === "money") {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: "Enter a non-negative amount.", values: echo };
    }
    if (n > 10_000_000) {
      return { ok: false, error: "That amount looks wrong — check it.", values: echo };
    }
  }

  if (spec.kind === "percent-list") {
    const parts = raw === "" ? [] : raw.split(",").map((p) => Number(p.trim()));
    if (parts.some((n) => !Number.isFinite(n) || n < 0 || n > 100)) {
      return { ok: false, error: "Percentages must be numbers between 0 and 100.", values: echo };
    }
  }

  if (spec.kind === "toggle" && raw !== "on" && raw !== "off") {
    return { ok: false, error: "Invalid toggle value.", values: echo };
  }

  const value = spec.kind === "money" ? String(Number(raw)) : raw;

  await db.setting.upsert({
    where: { key },
    update: { value, label: spec.label },
    create: { key, value, label: spec.label },
  });

  // Fees are read per transaction, so a change lands on the NEXT payment and
  // never rewrites a receipt that already exists.
  revalidatePath(PATH);
  revalidatePath("/payment");
  revalidatePath("/my-students");
  return { ok: true, savedKey: key };
}

const toggleSchema = z.object({ key: z.string().min(1), on: z.enum(["on", "off"]) });

/** Toggles get their own action so a switch is one click, not a form submit. */
export async function setToggle(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["ADMIN"]);

  const parsed = toggleSchema.safeParse({ key: formData.get("key"), on: formData.get("on") });
  if (!parsed.success) return { ok: false, error: "Invalid toggle." };

  const spec = SETTING_SPECS.find((s) => s.key === parsed.data.key && s.kind === "toggle");
  if (!spec) return { ok: false, error: "Unknown toggle." };

  await db.setting.upsert({
    where: { key: spec.key },
    update: { value: parsed.data.on, label: spec.label },
    create: { key: spec.key, value: parsed.data.on, label: spec.label },
  });

  revalidatePath(PATH);
  revalidatePath("/my-students");
  return { ok: true, savedKey: spec.key };
}
