"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { changeOwnPassword, type ActionState } from "./actions";

const EMPTY: ActionState = { ok: false };

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const [state, formAction, pending] = useActionState(changeOwnPassword, EMPTY);

  return (
    <form action={formAction} className="bg-card space-y-4 rounded-xl border p-6 shadow-sm">
      {forced && (
        <p className="bg-secondary text-secondary-foreground rounded-md px-3 py-2 text-sm">
          Your password was set by an administrator. Choose your own before
          continuing — nobody else should know it.
        </p>
      )}

      {/* Not asked for on a forced change: the "current" password is one an
          admin chose and typing it back proves nothing. */}
      {!forced && (
        <div className="space-y-2">
          <Label htmlFor="current">Current password</Label>
          <Input
            id="current"
            name="current"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
        />
        <p className="text-muted-foreground text-xs">At least 8 characters.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
        />
      </div>

      {state.error && (
        <p
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {state.error}
        </p>
      )}

      <Button type="submit" className="w-full gap-2" disabled={pending}>
        <KeyRound className="size-4" aria-hidden />
        {pending ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
