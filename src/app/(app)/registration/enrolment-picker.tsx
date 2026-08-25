"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export type CourseOption = { id: number; label: string };
export type FeeTierOption = { id: number; label: string; multiplier: string };

export const SELECT_CLASS =
  "border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50";

type Row = { key: number; courseId: string; feeTierId: string };

let nextKey = 1;

/**
 * Repeatable course + fee-tier rows. Each row submits parallel `courseId` and
 * `feeTierId` entries, which the server zips back together.
 *
 * At least one row is required, enforced again server-side — this component
 * only makes that obvious rather than being the guarantee.
 */
export function EnrolmentPicker({
  courses,
  feeTiers,
  disabledCourseIds = [],
}: {
  courses: CourseOption[];
  feeTiers: FeeTierOption[];
  /** Courses the student is already actively enrolled in. */
  disabledCourseIds?: number[];
}) {
  const defaultTier = feeTiers[0]?.id ? String(feeTiers[0].id) : "";
  const [rows, setRows] = useState<Row[]>([
    { key: 0, courseId: "", feeTierId: defaultTier },
  ]);

  const chosen = new Set(rows.map((r) => r.courseId).filter(Boolean));

  function update(key: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  const available = courses.filter(
    (c) => !disabledCourseIds.includes(c.id) && !chosen.has(String(c.id)),
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Enrolments</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={available.length === 0}
          onClick={() =>
            setRows((rs) => [
              ...rs,
              { key: nextKey++, courseId: "", feeTierId: defaultTier },
            ])
          }
        >
          <Plus className="size-3.5" aria-hidden />
          Add course
        </Button>
      </div>

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.key} className="flex items-start gap-2">
            <select
              name="courseId"
              className={SELECT_CLASS}
              value={row.courseId}
              onChange={(e) => update(row.key, { courseId: e.target.value })}
              required
            >
              <option value="" disabled>
                Select course…
              </option>
              {courses.map((c) => {
                const taken =
                  disabledCourseIds.includes(c.id) ||
                  (chosen.has(String(c.id)) && row.courseId !== String(c.id));
                return (
                  <option key={c.id} value={c.id} disabled={taken}>
                    {c.label}
                    {disabledCourseIds.includes(c.id) ? " — already enrolled" : ""}
                  </option>
                );
              })}
            </select>

            <select
              name="feeTierId"
              className={`${SELECT_CLASS} max-w-40`}
              value={row.feeTierId}
              onChange={(e) => update(row.key, { feeTierId: e.target.value })}
              required
            >
              {feeTiers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0"
              disabled={rows.length === 1}
              onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
              aria-label="Remove this enrolment"
            >
              <X className="size-4" aria-hidden />
            </Button>
          </div>
        ))}
      </div>

      <p className="text-muted-foreground text-xs">
        A student must be enrolled in at least one course to be saved.
      </p>
    </div>
  );
}
