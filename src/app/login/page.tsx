import { AuthError, CredentialsSignin } from "next-auth";
import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const metadata = { title: "Sign in" };

async function login(formData: FormData) {
  "use server";

  try {
    await signIn("credentials", {
      username: String(formData.get("username") ?? ""),
      password: String(formData.get("password") ?? ""),
      redirectTo: "/",
    });
  } catch (error) {
    // A successful signIn throws NEXT_REDIRECT, which must be rethrown.
    if (error instanceof AuthError) {
      // A locked account carries the Colombo time the lock lifts, so the page
      // can say something true instead of "wrong password".
      const code = error instanceof CredentialsSignin ? error.code : "";
      if (typeof code === "string" && code.startsWith("locked:")) {
        redirect(`/login?locked=${encodeURIComponent(code.slice("locked:".length))}`);
      }
      redirect("/login?error=1");
    }
    throw error;
  }
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // The authoritative "are you actually signed in" check — it runs the Node jwt
  // callback, so a revoked or deactivated session lands on the form instead of
  // being bounced to a page that would bounce it straight back here.
  const session = await auth();
  if (session?.user) {
    redirect(session.user.mustChangePassword ? "/change-password" : "/");
  }

  const params = await searchParams;
  const failed = "error" in params;
  const lockedUntil = typeof params.locked === "string" ? params.locked : null;
  const revoked = "revoked" in params;
  const passwordChanged = "changed" in params;

  return (
    <div className="from-primary/10 flex min-h-svh items-center justify-center bg-gradient-to-b to-transparent px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="bg-primary text-primary-foreground grid size-12 place-items-center rounded-xl text-lg font-bold">
            X
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Xenon</h1>
            <p className="text-muted-foreground text-sm">Sign in to continue</p>
          </div>
        </div>

        <form action={login} className="bg-card space-y-4 rounded-xl border p-6 shadow-sm">
          {lockedUntil ? (
            <p
              role="alert"
              className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
            >
              Too many attempts — try again after {lockedUntil}.
            </p>
          ) : failed ? (
            <p
              role="alert"
              className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
            >
              Incorrect username or password.
            </p>
          ) : revoked ? (
            <p
              role="alert"
              className="bg-secondary text-secondary-foreground rounded-md px-3 py-2 text-sm"
            >
              Your session has ended. Sign in again.
            </p>
          ) : passwordChanged ? (
            <p className="bg-secondary text-secondary-foreground rounded-md px-3 py-2 text-sm">
              Password changed. Sign in with the new one.
            </p>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>

          <Button type="submit" className="w-full">
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
