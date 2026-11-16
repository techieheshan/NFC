"use client";

import { useState, useTransition } from "react";
import { Users } from "lucide-react";

import { syncMarks } from "@/app/(app)/attendance/actions";
import { Button } from "@/components/ui/button";
import { dropFromOutbox, readOutbox } from "@/lib/offline-store";

import { switchUser } from "./switch-user-action";

/**
 * "Switch user": sign out and open the sign-in screen for the next person.
 *
 * The offline outbox belongs to the DEVICE, not to a person, and the server stamps each mark with whoever FLUSHES it (AGENTS 21). So a switch
 * first tries to send what is waiting, under the current person's name. If marks are still waiting (the terminal is offline), it does not switch
 * quietly: it says how many, and only a second, deliberate tap switches anyway, after saying they will go out under the next person's name.
 * The outbox code is read and called, never changed.
 */
export function SwitchUserButton() {
  const [waiting, setWaiting] = useState<number | null>(null);
  const [pending, start] = useTransition();

  const go = () => start(async () => { await switchUser(); });

  const tap = () =>
    start(async () => {
      let items = [] as Awaited<ReturnType<typeof readOutbox>>;
      try {
        items = await readOutbox();
        if (items.length > 0) {
          const outcomes = await syncMarks(
            items.map((i) => ({ clientRef: i.clientRef, studentId: i.studentId, courseId: i.courseId, additionalClassId: i.additionalClassId, method: i.method, date: i.date })),
          );
          await dropFromOutbox(outcomes.filter((o) => o.settled).map((o) => o.clientRef));
          items = await readOutbox();
        }
      } catch {
        // Offline or cut off: nothing was dropped, so whatever is still in the outbox is still waiting.
        try {
          items = await readOutbox();
        } catch {
          items = [];
        }
      }
      if (items.length > 0) {
        setWaiting(items.length);
        return;
      }
      await switchUser();
    });

  if (waiting !== null) {
    return (
      <div role="alertdialog" aria-label="Marks are still waiting" className="bg-card fixed inset-x-3 top-16 z-50 space-y-2 rounded-xl border p-3 shadow-lg sm:left-auto sm:w-96">
        <p className="text-sm font-medium">{waiting} mark{waiting === 1 ? " is" : "s are"} still waiting to be sent.</p>
        <p className="text-muted-foreground text-sm">Stay signed in until this terminal is online. If you switch now they will be sent under the next person&apos;s name.</p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="min-h-11" onClick={() => setWaiting(null)}>Stay signed in</Button>
          <Button variant="destructive" className="min-h-11" disabled={pending} onClick={go}>Switch anyway</Button>
        </div>
      </div>
    );
  }
  return (
    <Button type="button" variant="ghost" size="sm" className="min-h-11 gap-2" disabled={pending} onClick={tap}>
      <Users className="size-4" aria-hidden />
      <span className="hidden sm:inline">Switch user</span>
      <span className="sr-only sm:hidden">Switch user</span>
    </Button>
  );
}
