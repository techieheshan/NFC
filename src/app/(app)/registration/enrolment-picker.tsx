"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Picker } from "@/components/ui/picker";

import type { CoursePick, SubjectPick } from "./actions";
import { CourseCascade, type StreamPick } from "./course-cascade";

export type CourseOption = { id: number; label: string; hint?: string };
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
  streams,
  feeTiers,
  loadSubjects,
  loadCourses,
  disabledCourseIds = [],
}: {
  streams: StreamPick[];
  feeTiers: FeeTierOption[];
  loadSubjects: (streamId: number) => Promise<SubjectPick[]>;
  loadCourses: (input: { subjectId?: number; all?: boolean }) => Promise<CoursePick[]>;
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-base">Enrolments</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11 gap-1.5 px-4 text-base"
          onClick={() =>
            setRows((rs) => [
              ...rs,
              { key: nextKey++, courseId: "", feeTierId: defaultTier },
            ])
          }
        >
          <Plus className="size-4" aria-hidden />
          Add course
        </Button>
      </div>

      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.key} className="space-y-2 rounded-lg border p-2">
            <CourseCascade
              streams={streams}
              value={row.courseId}
              onChange={(courseId) => update(row.key, { courseId })}
              loadSubjects={loadSubjects}
              loadCourses={loadCourses}
              unavailable={(id) =>
                disabledCourseIds.includes(id)
                  ? "already enrolled"
                  : chosen.has(String(id)) && row.courseId !== String(id)
                    ? "already on this form"
                    : null
              }
            />

            <div className="flex items-center gap-2">
              <Picker
                name="feeTierId"
                title="Fee tier"
                required
                className="flex-1"
                value={row.feeTierId}
                onChange={(feeTierId) => update(row.key, { feeTierId })}
                options={feeTiers.map((t) => ({ value: String(t.id), label: t.label }))}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-12 shrink-0"
                disabled={rows.length === 1}
                onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
                aria-label="Remove this enrolment"
              >
                <X className="size-5" aria-hidden />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <p className="text-muted-foreground text-sm">
        A student must be enrolled in at least one course to be saved.
      </p>
    </div>
  );
}
