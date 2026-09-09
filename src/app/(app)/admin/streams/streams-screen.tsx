"use client";

import { useActionState, useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

import { setStreamSubjects, type ActionState } from "./actions";

const EMPTY: ActionState = { ok: false };

export type StreamRow = {
  id: number;
  label: string;
  active: boolean;
  subjects: { id: number; label: string }[];
};

/**
 * Which subjects each stream offers.
 *
 * One form per stream so saving one cannot disturb another, and the subject
 * list is checkboxes rather than a multi-select: on the terminal a native
 * multi-select is unusable, and staff are reading down a list deciding
 * "yes / no" for each name.
 */
export function StreamsScreen({
  streams,
  subjects,
}: {
  streams: StreamRow[];
  subjects: { id: number; label: string }[];
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Streams &amp; subjects</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Which subjects each stream offers. Registration uses this to narrow the
          list staff pick from — a subject can belong to several streams, and
          unticking one here only removes the link, never the subject.
        </p>
      </div>

      {streams.map((s) => (
        <StreamCard key={s.id} stream={s} subjects={subjects} />
      ))}

      {streams.length === 0 && (
        <p className="text-muted-foreground rounded-xl border p-4 text-sm">No streams yet.</p>
      )}
    </div>
  );
}

function StreamCard({
  stream,
  subjects,
}: {
  stream: StreamRow;
  subjects: { id: number; label: string }[];
}) {
  const [state, action, pending] = useActionState(setStreamSubjects, EMPTY);
  const [picked, setPicked] = useState<Set<number>>(
    () => new Set(stream.subjects.map((x) => x.id)),
  );

  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <form action={action} className={`rounded-xl border ${stream.active ? "" : "bg-muted/40"}`}>
      <input type="hidden" name="streamId" value={stream.id} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div>
          <h2 className="font-medium">
            {stream.label}
            {!stream.active && <span className="text-muted-foreground"> (inactive)</span>}
          </h2>
          <p className="text-muted-foreground text-sm">
            {picked.size} {picked.size === 1 ? "subject" : "subjects"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {state.ok && !pending && (
            <span className="flex items-center gap-1 text-sm text-emerald-700">
              <Check className="size-4" aria-hidden />
              Saved
            </span>
          )}
          <Button type="submit" size="sm" disabled={pending} className="gap-1.5">
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Save
          </Button>
        </div>
      </div>

      <div className="grid gap-1 p-3 sm:grid-cols-2">
        {subjects.map((sub) => {
          const on = picked.has(sub.id);
          return (
            <label
              key={sub.id}
              className="hover:bg-accent flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm"
            >
              {/* A plain checkbox, not the Radix one: the whole row must be
                  tappable, and a native input inside a label already is. */}
              <input
                type="checkbox"
                name="subjectId"
                value={sub.id}
                checked={on}
                onChange={() => toggle(sub.id)}
                className="accent-primary size-4"
              />
              <span className="min-w-0 flex-1 truncate">{sub.label}</span>
            </label>
          );
        })}
        {subjects.length === 0 && (
          <p className="text-muted-foreground p-2 text-sm">
            No subjects yet — add them in Setup → Subjects first.
          </p>
        )}
      </div>

      {state.error && <p className="text-destructive px-4 pb-3 text-sm">{state.error}</p>}
    </form>
  );
}
