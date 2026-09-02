"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { setVoiceEnabled, VOICE } from "@/lib/voice";

import type { ActionState, Identifier, LookupResult, StudentView } from "./actions";
import { CardScanner } from "./card-scanner";
import { ExistingStudent } from "./existing-student";
import type { CourseOption, FeeTierOption } from "./enrolment-picker";
import { NewStudentForm } from "./new-student-form";

type Phase =
  | { kind: "scan" }
  | { kind: "new"; captured: Identifier }
  | { kind: "existing"; student: StudentView; captured: Identifier }
  | { kind: "saved" };

type Props = {
  courses: CourseOption[];
  feeTiers: FeeTierOption[];
  lookupCard: (input: Identifier) => Promise<LookupResult>;
  refreshStudent: (studentId: number) => Promise<StudentView | null>;
  createStudent: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  addEnrolment: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  updateStudent: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  updatePhoto: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  attachIdentifier: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  /** Set when Search deep-links a student; otherwise the flow starts at scan. */
  initialStudent?: StudentView | null;
  /** From the Settings voice toggle. */
  voiceEnabled?: boolean;
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
  attachIdentifier,
  initialStudent = null,
  voiceEnabled = false,
}: Props) {
  setVoiceEnabled(voiceEnabled);
  // Used as the INITIAL value only — never synced back in with an effect
  // (AGENTS.md rule 17). A different student means a different URL, so the
  // route change remounts this component with the new one.
  const [phase, setPhase] = useState<Phase>(
    initialStudent
      ? { kind: "existing", student: initialStudent, captured: {} }
      : { kind: "scan" },
  );
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * Which student the panel is showing. Held in a ref so `refresh` can stay a
   * stable callback: it's passed to dialogs whose effects list it as a
   * dependency, and an identity that changed every render would re-fire them.
   */
  const shownStudentId = useRef<number | null>(initialStudent?.id ?? null);

  /** What the current visit's scan captured, kept for the refresh path. */
  const capturedRef = useRef<Identifier>({});

  const showStudent = useCallback((student: StudentView, captured: Identifier) => {
    shownStudentId.current = student.id;
    capturedRef.current = captured;
    setPhase({ kind: "existing", student, captured });
  }, []);

  const handleIdentify = useCallback(
    (identifier: Identifier) => {
      setLookupError(null);
      startTransition(async () => {
        const result = await lookupCard(identifier);
        if (result.status === "invalid") {
          setLookupError(result.message);
        } else if (result.status === "new") {
          setPhase({ kind: "new", captured: result.captured });
        } else {
          showStudent(result.student, result.captured);
        }
      });
    },
    [lookupCard, showStudent],
  );

  const backToScan = useCallback(() => {
    shownStudentId.current = null;
    capturedRef.current = {};
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
      if (fresh) showStudent(fresh, capturedRef.current);
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
        captured={phase.captured}
        courses={courses}
        feeTiers={feeTiers}
        action={createStudent}
        onSaved={() => {
          VOICE.registered();
          setPhase({ kind: "saved" });
        }}
        onBack={backToScan}
      />
    );
  }

  if (phase.kind === "existing") {
    return (
      <ExistingStudent
        student={phase.student}
        captured={phase.captured}
        courses={courses}
        feeTiers={feeTiers}
        actions={{ addEnrolment, updateStudent, updatePhoto, attachIdentifier }}
        onChanged={refresh}
        onBack={backToScan}
      />
    );
  }

  return (
    <div className="space-y-4">
      <CardScanner onIdentify={handleIdentify} busy={pending} />
      {lookupError && (
        <p role="alert" className="text-destructive mx-auto max-w-md text-sm">
          {lookupError}
        </p>
      )}
    </div>
  );
}
