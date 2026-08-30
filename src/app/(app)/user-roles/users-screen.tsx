"use client";

import { useActionState, useEffect, useState } from "react";
import { KeyRound, LogOut, Power, UserPlus } from "lucide-react";

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

import {
  createUser,
  logOutAllSessions,
  resetPassword,
  setUserActive,
  type ActionState,
  type UserRow,
} from "./actions";

const EMPTY: ActionState = { ok: false };

const SELECT_CLASS =
  "border-input bg-background h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs";

export function UsersScreen({ users }: { users: UserRow[] }) {
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const [toggling, setToggling] = useState<UserRow | null>(null);
  const [signingOut, setSigningOut] = useState<UserRow | null>(null);

  const activeAdmins = users.filter((u) => u.role === "ADMIN" && u.active).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">User Roles</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Logins for this institute. Teacher logins are created with the teacher
            under Setup → Teachers; they can be reset and deactivated here.
          </p>
        </div>
        <Button className="gap-1.5" onClick={() => setCreating(true)}>
          <UserPlus className="size-4" aria-hidden />
          New user
        </Button>
      </div>

      <ul className="divide-y rounded-xl border">
        {users.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                <span>{u.username}</span>
                <Badge variant={u.role === "ADMIN" ? "default" : "secondary"}>
                  {u.role}
                </Badge>
                {!u.active && <Badge variant="outline">Inactive</Badge>}
                {u.lockedUntil && (
                  <Badge variant="destructive">Locked until {u.lockedUntil}</Badge>
                )}
                {u.mustChangePassword && (
                  <Badge variant="outline">Must change password</Badge>
                )}
                {u.isSelf && <Badge variant="outline">You</Badge>}
              </p>
              <p className="text-muted-foreground text-sm">
                {u.linkedTo ?? "Not linked to a teacher or staff record"}
              </p>
            </div>

            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setResetting(u)}
              >
                <KeyRound className="size-3.5" aria-hidden />
                Reset password
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setSigningOut(u)}
              >
                <LogOut className="size-3.5" aria-hidden />
                Sign out everywhere
              </Button>
              <Button
                size="sm"
                variant={u.active ? "destructive" : "outline"}
                className="gap-1.5"
                // Both refusals are enforced in the action; disabling here only
                // saves the round trip on the two cases we can already see.
                disabled={u.active && (u.isSelf || (u.role === "ADMIN" && activeAdmins === 1))}
                onClick={() => setToggling(u)}
              >
                <Power className="size-3.5" aria-hidden />
                {u.active ? "Deactivate" : "Reactivate"}
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {creating && <CreateDialog onClose={() => setCreating(false)} />}
      {resetting && (
        <ResetDialog key={resetting.id} user={resetting} onClose={() => setResetting(null)} />
      )}
      {toggling && (
        <ToggleDialog key={toggling.id} user={toggling} onClose={() => setToggling(null)} />
      )}
      {signingOut && (
        <SignOutDialog
          key={signingOut.id}
          user={signingOut}
          onClose={() => setSigningOut(null)}
        />
      )}
    </div>
  );
}

/** Closes itself once the action reports success. */
function useCloseOnSuccess(ok: boolean, onClose: () => void) {
  useEffect(() => {
    if (ok) onClose();
  }, [ok, onClose]);
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const [state, formAction, pending] = useActionState(createUser, EMPTY);
  useCloseOnSuccess(state.ok, onClose);
  // React 19 resets the form once the action resolves; without these the
  // username would vanish on "already taken". Passwords are deliberately NOT
  // echoed — see `echo` in actions.ts.
  const v = state.values;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>New user</DialogTitle>
            <DialogDescription>
              An admin or staff login. Teacher logins belong to Setup → Teachers,
              where the teacher and the login are created together.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                name="username"
                defaultValue={v?.username ?? ""}
                autoComplete="off"
                spellCheck={false}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              {/* Keyed on the echoed value: a <select> only applies
                  defaultValue at mount, and a reset to the disabled
                  placeholder would drop the field from the submission. */}
              <select
                id="role"
                name="role"
                key={v?.role ?? "STAFF"}
                className={SELECT_CLASS}
                defaultValue={v?.role ?? "STAFF"}
                required
              >
                <option value="STAFF">Staff</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
              />
              <p className="text-muted-foreground text-xs">At least 8 characters.</p>
            </div>

            {state.error && (
              <p role="alert" className="text-destructive text-sm">
                {state.error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(resetPassword, EMPTY);
  useCloseOnSuccess(state.ok, onClose);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Reset {user.username}&apos;s password</DialogTitle>
            <DialogDescription>
              The current password is not needed. Tell them the new one directly —
              it is stored hashed and can never be read back.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <input type="hidden" name="id" value={user.id} />
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
              />
              <p className="text-muted-foreground text-xs">At least 8 characters.</p>
            </div>

            {user.isSelf && (
              <p className="bg-secondary text-secondary-foreground rounded-lg px-3 py-2 text-sm">
                This is your own login. You will stay signed in, but the new
                password is what you use next time.
              </p>
            )}

            {state.error && (
              <p role="alert" className="text-destructive text-sm">
                {state.error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Set password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ToggleDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(setUserActive, EMPTY);
  useCloseOnSuccess(state.ok, onClose);
  const deactivating = user.active;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>
              {deactivating ? "Deactivate" : "Reactivate"} {user.username}?
            </DialogTitle>
            <DialogDescription>
              {deactivating
                ? "They will be refused at login. Nothing is deleted — everything they recorded keeps their name on it."
                : "They will be able to sign in again with their existing password."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <input type="hidden" name="id" value={user.id} />
            <input type="hidden" name="active" value={deactivating ? "false" : "true"} />
            {state.error && (
              <p role="alert" className="text-destructive text-sm">
                {state.error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Keep as is
            </Button>
            <Button
              type="submit"
              variant={deactivating ? "destructive" : "default"}
              disabled={pending}
            >
              {pending ? "Saving…" : deactivating ? "Deactivate" : "Reactivate"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SignOutDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(logOutAllSessions, EMPTY);
  useCloseOnSuccess(state.ok, onClose);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Sign {user.username} out everywhere?</DialogTitle>
            <DialogDescription>
              Every device they are signed in on is ended at its next request.
              Their password is unchanged — they can sign back in with it.
              {user.isSelf && " That includes this browser."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <input type="hidden" name="id" value={user.id} />
            {state.error && (
              <p role="alert" className="text-destructive text-sm">
                {state.error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Signing out…" : "Sign out everywhere"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
