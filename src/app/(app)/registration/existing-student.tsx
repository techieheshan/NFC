"use client";

import { useActionState, useEffect, useState } from "react";
import {
  ArrowLeft,
  CreditCard,
  Link as LinkIcon,
  Pencil,
  Plus,
  UserRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCardUid } from "@/lib/card-uid";

import type { ActionState, Identifier, StudentView } from "./actions";
import { CardFields } from "./card-fields";
import {
  SELECT_CLASS,
  type CourseOption,
  type FeeTierOption,
} from "./enrolment-picker";
import { PhotoCapture } from "./photo-capture";

const EMPTY: ActionState = { ok: false };

type Actions = {
  addEnrolment: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  updateStudent: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  updatePhoto: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  attachIdentifier: (prev: ActionState, formData: FormData) => Promise<ActionState>;
};

export function ExistingStudent({
  student,
  captured,
  courses,
  feeTiers,
  actions,
  onChanged,
  onBack,
}: {
  student: StudentView;
  /** What this visit's scan captured, so a missing identifier can be filled. */
  captured: Identifier;
  courses: CourseOption[];
  feeTiers: FeeTierOption[];
  actions: Actions;
  onChanged: () => void;
  onBack: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [changingPhoto, setChangingPhoto] = useState(false);
  const [attaching, setAttaching] = useState<"cardUid" | "cardNumber" | null>(null);

  /**
   * The student was found by one identifier but is missing the other, and this
   * visit captured it — e.g. registered by QR, now tapped. Offer to fill it in
   * rather than making staff re-register the card elsewhere.
   */
  const missing: { kind: "cardUid" | "cardNumber"; value: string } | null =
    !student.cardUid && captured.cardUid
      ? { kind: "cardUid", value: captured.cardUid }
      : !student.cardNumber && captured.cardNumber
        ? { kind: "cardNumber", value: captured.cardNumber }
        : null;

  const activeCourseIds = student.enrolments
    .filter((e) => e.status === "ACTIVE")
    .map((e) => e.courseId);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{student.name}</h1>
          <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <CreditCard className="size-4" aria-hidden />
            <span className="font-mono">{student.cardNumber ?? "no card number"}</span>
            <span className="font-mono">
              {student.cardUid ? formatCardUid(student.cardUid) : "no UID"}
            </span>
          </p>
        </div>
        <Button type="button" variant="ghost" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="size-4" aria-hidden />
          Scan another
        </Button>
      </div>

      {missing && (
        <div className="border-primary/30 bg-primary/5 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
          <p className="text-sm">
            This student has no{" "}
            {missing.kind === "cardUid" ? "card UID" : "card number"} on file.
            Add the one just scanned:{" "}
            <span className="font-mono font-medium">
              {missing.kind === "cardUid" ? formatCardUid(missing.value) : missing.value}
            </span>
          </p>
          <Button size="sm" onClick={() => setAttaching(missing.kind)}>
            <LinkIcon className="size-3.5" aria-hidden />
            Add to student
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-5 rounded-xl border p-4">
        <div className="bg-muted relative size-28 shrink-0 overflow-hidden rounded-lg border">
          {student.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={student.photoUrl}
              alt={student.name}
              className="size-full object-cover"
            />
          ) : (
            <div className="text-muted-foreground grid size-full place-items-center">
              <UserRound className="size-8" aria-hidden />
            </div>
          )}
        </div>

        <dl className="min-w-48 flex-1 space-y-1.5 text-sm">
          <Field label="Phone" value={student.phone} />
          <Field label="School" value={student.school} />
          <Field label="NIC" value={student.nic} />
          <Field label="Address" value={student.address} />
          <div className="flex gap-2 pt-1">
            <Badge variant={student.admissionPaid ? "default" : "secondary"}>
              {student.admissionPaid ? "Admission paid" : "Admission unpaid"}
            </Badge>
          </div>
        </dl>

        <div className="flex flex-col gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" aria-hidden />
            Edit details
          </Button>
          <Button variant="outline" size="sm" onClick={() => setChangingPhoto(true)}>
            {student.photoUrl ? "Replace photo" : "Add photo"}
          </Button>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Enrolments</h2>
          <Button size="sm" className="gap-1.5" onClick={() => setEnrolling(true)}>
            <Plus className="size-3.5" aria-hidden />
            Add enrolment
          </Button>
        </div>

        {student.enrolments.length === 0 ? (
          <p className="text-muted-foreground text-sm">No enrolments yet.</p>
        ) : (
          <ul className="divide-y">
            {student.enrolments.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-sm">{e.course}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline">{e.feeTier}</Badge>
                  {e.status === "DROPPED" && (
                    <Badge variant="secondary">Dropped</Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ActionDialog
        key={enrolling ? "enrol" : "enrol-closed"}
        open={enrolling}
        onOpenChange={setEnrolling}
        onDone={onChanged}
        action={actions.addEnrolment}
        title="Add enrolment"
        description={`Enrol ${student.name} in another course.`}
        submitLabel="Enrol"
      >
        <input type="hidden" name="studentId" value={student.id} />
        <div className="space-y-2">
          <Label htmlFor="courseId">Course</Label>
          <select id="courseId" name="courseId" className={SELECT_CLASS} required defaultValue="">
            <option value="" disabled>
              Select course…
            </option>
            {courses.map((c) => (
              <option key={c.id} value={c.id} disabled={activeCourseIds.includes(c.id)}>
                {c.label}
                {activeCourseIds.includes(c.id) ? " — already enrolled" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="feeTierId">Fee tier</Label>
          <select
            id="feeTierId"
            name="feeTierId"
            className={SELECT_CLASS}
            required
            defaultValue={feeTiers[0]?.id ?? ""}
          >
            {feeTiers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </ActionDialog>

      <ActionDialog
        key={editing ? "edit" : "edit-closed"}
        open={editing}
        onOpenChange={setEditing}
        onDone={onChanged}
        action={actions.updateStudent}
        title="Edit details"
        description="Update this student's details, including their card."
        submitLabel="Save"
      >
        {/*
          `v` is the echoed submission. A card clash keeps this dialog open, and
          React 19 has already reset the form by then — without these defaults
          every other edit in the dialog would be wiped. See AGENTS.md rule 14.
        */}
        {(v) => (
          <>
            <input type="hidden" name="studentId" value={student.id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="edit-name">Name</Label>
                <Input id="edit-name" name="name" defaultValue={v?.name ?? student.name} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-phone">Phone</Label>
                <Input id="edit-phone" name="phone" defaultValue={v?.phone ?? student.phone ?? ""} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-school">School</Label>
                <Input id="edit-school" name="school" defaultValue={v?.school ?? student.school ?? ""} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-nic">NIC</Label>
                <Input id="edit-nic" name="nic" defaultValue={v?.nic ?? student.nic ?? ""} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-address">Address</Label>
                <Input id="edit-address" name="address" defaultValue={v?.address ?? student.address ?? ""} />
              </div>
            </div>

            {/* Overwrite in place: a typo gets corrected, and a lost card is
                reissued by writing the new UID over the old one. */}
            <div className="space-y-3 rounded-lg border p-3">
              <p className="text-sm font-medium">Card</p>
              <CardFields
                idPrefix="edit"
                defaultCardNumber={student.cardNumber ?? ""}
                defaultCardUid={student.cardUid ?? ""}
              />
            </div>
          </>
        )}
      </ActionDialog>

      <ActionDialog
        key={attaching ? `attach-${attaching}` : "attach-closed"}
        open={attaching !== null}
        onOpenChange={(o) => !o && setAttaching(null)}
        onDone={onChanged}
        action={actions.attachIdentifier}
        title={attaching === "cardUid" ? "Add card UID" : "Add card number"}
        description={`Link this identifier to ${student.name}.`}
        submitLabel="Add"
      >
        <input type="hidden" name="studentId" value={student.id} />
        <input type="hidden" name="kind" value={attaching ?? ""} />
        <div className="space-y-2">
          <Label htmlFor="attach-value">
            {attaching === "cardUid" ? "Card UID" : "Card number"}
          </Label>
          <Input
            id="attach-value"
            name="value"
            defaultValue={missing?.value ?? ""}
            autoComplete="off"
            spellCheck={false}
            required
          />
        </div>
      </ActionDialog>

      <ActionDialog
        key={changingPhoto ? "photo" : "photo-closed"}
        open={changingPhoto}
        onOpenChange={setChangingPhoto}
        onDone={onChanged}
        action={actions.updatePhoto}
        title={student.photoUrl ? "Replace photo" : "Add photo"}
        description="Replaces the stored image in place."
        submitLabel="Upload"
      >
        <input type="hidden" name="studentId" value={student.id} />
        <PhotoCapture label="Photo" currentUrl={student.photoUrl} />
      </ActionDialog>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground w-16 shrink-0">{label}</dt>
      <dd>{value ?? "—"}</dd>
    </div>
  );
}

function ActionDialog({
  open,
  onOpenChange,
  onDone,
  action,
  title,
  description,
  submitLabel,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  title: string;
  description: string;
  submitLabel: string;
  /** A render function receives the echoed values of a rejected submission. */
  children: React.ReactNode | ((values?: Record<string, string>) => React.ReactNode);
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY);

  useEffect(() => {
    if (state.ok) {
      onOpenChange(false);
      onDone();
    }
  }, [state.ok, onOpenChange, onDone]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {typeof children === "function" ? children(state.values) : children}
            {state.error && (
              <p role="alert" className="text-destructive text-sm">
                {state.error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
