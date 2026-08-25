import { LogOut } from "lucide-react";

import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";

/**
 * A plain <form> posting to a server action — no client bundle, and it still
 * works if JS hasn't hydrated yet (which on the terminal is the common case).
 */
export function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      <Button type="submit" variant="ghost" size="sm" className="gap-2">
        <LogOut className="size-4" aria-hidden />
        <span className="hidden sm:inline">Sign out</span>
        <span className="sr-only sm:hidden">Sign out</span>
      </Button>
    </form>
  );
}
