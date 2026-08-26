"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The two attendance-window offsets, shared by both forms.
 *
 * They are relative to different ends of the class, which is the part people
 * get wrong — so the hint spells out the resulting clock times.
 */
export function WindowFields({
  opensBefore = 30,
  closesBefore = 30,
}: {
  opensBefore?: number;
  closesBefore?: number;
}) {
  return (
    <div className="space-y-2 rounded-lg border p-4">
      <p className="text-sm font-medium">Attendance window</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="attendanceOpensBeforeMin">Opens before start (min)</Label>
          <Input
            id="attendanceOpensBeforeMin"
            name="attendanceOpensBeforeMin"
            type="number"
            min="0"
            step="1"
            defaultValue={opensBefore}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="attendanceClosesBeforeMin">Closes before end (min)</Label>
          <Input
            id="attendanceClosesBeforeMin"
            name="attendanceClosesBeforeMin"
            type="number"
            min="0"
            step="1"
            defaultValue={closesBefore}
          />
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        Opens counts back from the <strong>start</strong>, closes counts back from
        the <strong>end</strong>. A 3:00–5:00 class with 30 / 30 accepts marks
        between 2:30 and 4:30.
      </p>
    </div>
  );
}
