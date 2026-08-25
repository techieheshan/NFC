"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { ActionState, LookupResult, StudentView } from "./actions";
import { CardScanner } from "./card-scanner";
import { ExistingStudent } from "./existing-student";
import type { CourseOption, FeeTierOption } from "./enrolment-picker";
import { NewStudentForm } from "./new-student-form";

type Phase =
  | { kind: "scan" }
  | { kind: "new"; cardUid: string }
  | { kind: "existing"; student: StudentView }
  | { kind: "saved" };

type Props = {
  courses: CourseOption[];
  feeTiers: FeeTierOption[];
  lookupCard: (uid: string) => Promise<LookupResult>;
  refreshStudent: (studentId: number) => Promise<StudentView | null>;
  createStudent: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  addEnrolment: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  updateStudent: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  updatePhoto: (prev: ActionState, formData: FormData) => Promise<ActionState>;
};

/**
 * Registration is scan-driven, so the whole screen is one small state machine:
 * scan -> (new | existing) -> back to scan. There is no student list here by
 * design; browsing students belongs to the Search tag.
 */
export function RegistrationScreen({
  courses,
  feeTiers,
  lookupCard,
  refreshStudent,
  createStudent,
  addEnrolment,
  updateStudent,
  updatePhoto,
}: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "scan" });
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * Which student the panel is showing. Held in a ref so `refresh` can stay a
   * stable callback: it's passed to dialogs whose effects list it as a
   * dependency, and an identity that changed every render would re-fire them.
   */
  const shownStudentId = useRef<number | null>(null);

  const showStudent = useCallback((student: StudentView) => {
    shownStudentId.current = student.id;
    setPhase({ kind: "existing", student });
  }, []);

  const handleUid = useCallback(
    (uid: string) => {
      setLookupError(null);
      startTransition(async () => {
        const result = await lookupCard(uid);
        if (result.status === "invalid") {
          setLookupError(result.message);
        } else if (result.status === "new") {
          setPhase({ kind: "new", cardUid: result.cardUid });
        } else {
          showStudent(result.student);
        }
      });
    },
    [lookupCard, showStudent],
  );

  const backToScan = useCallback(() => {
    shownStudentId.current = null;
    setLookupError(null);
    setPhase({ kind: "scan" });
  }, []);

  // After a mutation the server data is authoritative — re-read rather than
  // patching local state, so enrolment lists and photo URLs can't drift.
  const refresh = useCallback(() => {
    const studentId = shownStudentId.current;
    if (studentId === null) return;

    startTransition(async () => {
      const fresh = await refreshStudent(studentId);
      if (fresh) showStudent(fresh);
    });
  }, [refreshStudent, showStudent]);

  if (phase.kind === "saved") {
    return (
      <div className="mx-auto max-w-md space-y-6 text-center">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-emerald-100 text-emerald-700">
          <CheckCircle2 className="size-8" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Student saved</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Admission is still unpaid — take payment on the Payment screen.
          </p>
        </div>
        <Button onClick={backToScan} className="w-full">
          Scan next card
        </Button>
      </div>
    );
  }

  if (phase.kind === "new") {
    return (
      <NewStudentForm
        cardUid={phase.cardUid}
        courses={courses}
        feeTiers={feeTiers}
        action={createStudent}
        onSaved={() => setPhase({ kind: "saved" })}
        onBack={backToScan}
      />
    );
  }

  if (phase.kind === "existing") {
    return (
      <ExistingStudent
        student={phase.student}
        courses={courses}
        feeTiers={feeTiers}
        actions={{ addEnrolment, updateStudent, updatePhoto }}
        onChanged={refresh}
        onBack={backToScan}
      />
    );
  }

  return (
    <div className="space-y-4">
      <CardScanner onUid={handleUid} busy={pending} />
      {lookupError && (
        <p role="alert" className="text-destructive mx-auto max-w-md text-sm">
          {lookupError}
        </p>
      )}
    </div>
  );
}
