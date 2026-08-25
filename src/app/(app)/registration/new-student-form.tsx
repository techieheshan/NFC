"use client";

import { useActionState, useEffect } from "react";
import { ArrowLeft, CreditCard } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCardUid } from "@/lib/card-uid";

import type { ActionState } from "./actions";
import {
  EnrolmentPicker,
  type CourseOption,
  type FeeTierOption,
} from "./enrolment-picker";
import { PhotoCapture } from "./photo-capture";

const EMPTY: ActionState = { ok: false };

export function NewStudentForm({
  cardUid,
  courses,
  feeTiers,
  action,
  onSaved,
  onBack,
}: {
  cardUid: string;
  courses: CourseOption[];
  feeTiers: FeeTierOption[];
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  onSaved: () => void;
  onBack: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY);

  useEffect(() => {
    if (state.ok) onSaved();
  }, [state.ok, onSaved]);

  return (
    <form action={formAction} className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New student</h1>
          <p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-sm">
            <CreditCard className="size-4" aria-hidden />
            <span className="font-mono">{formatCardUid(cardUid)}</span>
          </p>
        </div>
        <Button type="button" variant="ghost" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="size-4" aria-hidden />
          Back
        </Button>
      </div>

      <input type="hidden" name="cardUid" value={cardUid} />

      {courses.length === 0 ? (
        <p className="bg-secondary text-secondary-foreground rounded-lg px-4 py-3 text-sm">
          There are no active courses yet, so nobody can be enrolled. Create one
          under Setup → Classes / Courses first.
        </p>
      ) : (
        <>
          <div className="space-y-4 rounded-xl border p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" autoComplete="off" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" name="phone" autoComplete="off" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="school">School</Label>
                <Input id="school" name="school" autoComplete="off" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nic">NIC (optional)</Label>
                <Input id="nic" name="nic" autoComplete="off" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">Address (optional)</Label>
                <Input id="address" name="address" autoComplete="off" />
              </div>
            </div>

            <PhotoCapture />
          </div>

          <div className="rounded-xl border p-4">
            <EnrolmentPicker courses={courses} feeTiers={feeTiers} />
          </div>
        </>
      )}

      {state.error && (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onBack}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || courses.length === 0}>
          {pending ? "Saving…" : "Save student"}
        </Button>
      </div>
    </form>
  );
}
