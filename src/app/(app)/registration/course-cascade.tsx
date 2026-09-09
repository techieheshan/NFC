"use client";

import { useCallback, useState } from "react";
import { Layers, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Picker } from "@/components/ui/picker";

import type { CoursePick, SubjectPick } from "./actions";

export type StreamPick = { id: number; label: string };

/**
 * Stream → Subject → Course, in three short lists instead of one long one.
 *
 * Staff were picking one course out of every course in the institute. The
 * cascade narrows it the way they already think: which stream the student is
 * in, which of that stream's subjects, then which of that subject's courses
 * (the teacher is the second line, because that is how two same-named courses
 * are told apart).
 *
 * GRADE IS NOT A STEP. A student sits in another grade's class to catch up all
 * the time, so grade stays data on the course and never a filter.
 *
 * "Any course" is the escape hatch, one tap away: the same catch-up case means
 * the right course is sometimes outside the student's stream entirely, and a
 * cascade with no way out would send staff to the database.
 *
 * Each step fetches only its own list, so a terminal never downloads every
 * course to show three of them.
 */
export function CourseCascade({
  streams,
  value,
  onChange,
  loadSubjects,
  loadCourses,
  /** Courses that cannot be picked again, with the reason to show. */
  unavailable,
}: {
  streams: StreamPick[];
  value: string;
  onChange: (courseId: string) => void;
  loadSubjects: (streamId: number) => Promise<SubjectPick[]>;
  loadCourses: (input: { subjectId?: number; all?: boolean }) => Promise<CoursePick[]>;
  unavailable?: (courseId: number) => string | null;
}) {
  const [streamId, setStreamId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [subjects, setSubjects] = useState<SubjectPick[]>([]);
  const [courses, setCourses] = useState<CoursePick[]>([]);
  const [anyCourse, setAnyCourse] = useState(false);
  const [busy, setBusy] = useState(false);

  const fetchCourses = useCallback(
    async (input: { subjectId?: number; all?: boolean }) => {
      setBusy(true);
      try {
        setCourses(await loadCourses(input));
      } finally {
        setBusy(false);
      }
    },
    [loadCourses],
  );

  /**
   * Picking a stream loads its subjects and clears everything below it: a
   * subject from the previous stream is not an answer to this one. The fetch
   * hangs off the event rather than an effect watching `streamId` — the choice
   * is what causes the load, and an effect would also fire on a remount.
   */
  const pickStream = async (next: string) => {
    setStreamId(next);
    setSubjectId("");
    setSubjects([]);
    setCourses([]);
    onChange("");
    if (!next) return;
    setBusy(true);
    try {
      setSubjects(await loadSubjects(Number(next)));
    } finally {
      setBusy(false);
    }
  };

  const pickSubject = (next: string) => {
    setSubjectId(next);
    onChange("");
    if (next) void fetchCourses({ subjectId: Number(next) });
    else setCourses([]);
  };

  const openAnyCourse = () => {
    setAnyCourse(true);
    setStreamId("");
    setSubjectId("");
    setSubjects([]);
    onChange("");
    void fetchCourses({ all: true });
  };

  const backToCascade = () => {
    setAnyCourse(false);
    setCourses([]);
    onChange("");
  };

  const courseOptions = courses.map((c) => {
    const why = unavailable?.(c.id) ?? null;
    return { value: String(c.id), label: c.label, hint: why ?? c.hint, disabled: Boolean(why) };
  });

  return (
    <div className="space-y-2">
      {anyCourse ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-sm">Showing every course.</p>
          <Button type="button" variant="ghost" size="sm" className="h-10" onClick={backToCascade}>
            Back to stream
          </Button>
        </div>
      ) : (
        <>
          <Picker
            title="Which stream?"
            placeholder="1. Stream…"
            value={streamId}
            onChange={(next) => void pickStream(next)}
            options={streams.map((s) => ({ value: String(s.id), label: s.label }))}
          />

          {streamId !== "" && (
            <Picker
              title="Which subject?"
              placeholder={subjects.length === 0 && !busy ? "No subjects on this stream" : "2. Subject…"}
              value={subjectId}
              onChange={pickSubject}
              options={subjects.map((s) => ({ value: String(s.id), label: s.label }))}
            />
          )}
        </>
      )}

      {(anyCourse || subjectId !== "") && (
        <Picker
          name="courseId"
          required
          title="Which course?"
          placeholder={busy ? "Loading courses…" : "3. Course…"}
          value={value}
          onChange={onChange}
          options={courseOptions}
        />
      )}

      <div className="flex items-center gap-2">
        {busy && <Loader2 className="text-muted-foreground size-4 animate-spin" aria-hidden />}
        {!anyCourse && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-10 gap-1.5 px-2"
            onClick={openAnyCourse}
          >
            <Layers className="size-4" aria-hidden />
            Any course (outside this stream)
          </Button>
        )}
      </div>
    </div>
  );
}
