"use client";

import { useActionState, useEffect } from "react";
import { ArrowLeft, CreditCard } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCardUid } from "@/lib/card-uid";

import type { ActionState, Identifier } from "./actions";
import {
  EnrolmentPicker,
  type CourseOption,
  type FeeTierOption,
} from "./enrolment-picker";
import { PhotoCapture } from "./photo-capture";

const EMPTY: ActionState = { ok: false };

export function NewStudentForm({
  captured,
  courses,
  feeTiers,
  action,
  onSaved,
  onBack,
}: {
  captured: Identifier;
  courses: CourseOption[];
  feeTiers: FeeTierOption[];
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  onSaved: () => void;
  onBack: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY);
  // React resets the form once the action resolves, so defaults must reflect a
  // rejected submission — otherwise "at least one identifier" or a card clash
  // would clear the whole registration. See AGENTS.md rule 14.
  const v = state.values;

  useEffect(() => {
    if (state.ok) onSaved();
  }, [state.ok, onSaved]);

  return (
    <form action={formAction} className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New student</h1>
          <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <CreditCard className="size-4" aria-hidden />
            {captured.cardNumber && (
              <span className="font-mono">{captured.cardNumber}</span>
            )}
            {captured.cardUid && (
              <span className="font-mono">{formatCardUid(captured.cardUid)}</span>
            )}
          </p>
        </div>
        <Button type="button" variant="ghost" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="size-4" aria-hidden />
          Back
        </Button>
      </div>


      {courses.length === 0 ? (
        <p className="bg-secondary text-secondary-foreground rounded-lg px-4 py-3 text-sm">
          There are no active courses yet, so nobody can be enrolled. Create one
          under Setup → Classes / Courses first.
        </p>
      ) : (
        <>
          <div className="space-y-4 rounded-xl border p-4">
            {/*
              Both identifiers are shown and editable, pre-filled from whatever
              the scan captured. Only one is required — an office with no NFC
              phone registers by card number alone, an NFC-only flow by UID.
            */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardNumber">Card number</Label>
                <Input
                  id="cardNumber"
                  name="cardNumber"
                  defaultValue={v?.cardNumber ?? captured.cardNumber ?? ""}
                  placeholder="0186-0001-2000"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardUid">Card UID</Label>
                <Input
                  id="cardUid"
                  name="cardUid"
                  defaultValue={v?.cardUid ?? captured.cardUid ?? ""}
                  placeholder="04A22B9C"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <p className="text-muted-foreground -mt-2 text-xs sm:col-span-2">
                At least one is required. Capture both when the card allows it.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" defaultValue={v?.name ?? ""} autoComplete="off" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" name="phone" defaultValue={v?.phone ?? ""} autoComplete="off" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="school">School</Label>
                <Input id="school" name="school" defaultValue={v?.school ?? ""} autoComplete="off" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nic">NIC (optional)</Label>
                <Input id="nic" name="nic" defaultValue={v?.nic ?? ""} autoComplete="off" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">Address (optional)</Label>
                <Input id="address" name="address" defaultValue={v?.address ?? ""} autoComplete="off" />
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
