import { AuthError, CredentialsSignin } from "next-auth";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { db } from "@/lib/db";
import { registerTerminalOnPasswordLogin } from "@/lib/quick-login";
import { firstHop, PASSWORD_NEEDED_TEXT, TERMINAL_COOKIE } from "@/lib/quick-login-rules";
import { getToggle } from "@/lib/settings";

import { QuickLoginPanel } from "./quick-panel";

export const metadata = { title: "Sign in" };

async function login(formData: FormData) {
  "use server";

  const username = String(formData.get("username") ?? "");
  try {
    await signIn("credentials", { username, password: String(formData.get("password") ?? ""), redirect: false });
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

  // A good PASSWORD sign-in makes this device a registered terminal for staff card sign-in (only while the feature is on) and resets the
  // terminal's quick sign-in count. A failure here must never stop a person from signing in with a password they typed correctly.
  try {
    const user = await db.user.findUnique({ where: { username }, select: { id: true } });
    if (user) {
      const jar = await cookies();
      const h = await headers();
      const { newToken } = await registerTerminalOnPasswordLogin({
        terminalToken: jar.get(TERMINAL_COOKIE)?.value ?? null,
        userId: user.id,
        ip: firstHop(h.get("x-forwarded-for")),
        userAgent: h.get("user-agent"),
      });
      if (newToken) {
        jar.set(TERMINAL_COOKIE, newToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 400 });
      }
    }
  } catch (e) {
    console.error("terminal registration failed", e instanceof Error ? e.message : e);
  }
  redirect("/");
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
  // Staff card sign-in: the panel shows only while the feature is on AND this device is already a registered terminal (a password sign-in made it one).
  const quickOn = await getToggle("quick_login_enabled");
  const registered = quickOn && Boolean((await cookies()).get(TERMINAL_COOKIE)?.value);
  const passwordNeeded = "pw" in params;
  const prefill = typeof params.u === "string" ? params.u.slice(0, 64) : "";
  const passwordChanged = "changed" in params;

  return (
    <div className="from-secondary flex min-h-screen items-center justify-center bg-gradient-to-b to-transparent px-4 py-12">
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

        {registered && !passwordNeeded && <QuickLoginPanel />}
        {quickOn && !registered && (
          <p className="text-muted-foreground mb-4 text-center text-xs">Staff: sign in with your password once on this device to turn on card sign-in here.</p>
        )}

        <form action={login} className="bg-card space-y-4 rounded-xl border p-6 shadow-sm">
          {lockedUntil ? (
            <p
              role="alert"
              className="border-destructive bg-destructive-soft text-destructive rounded-md border px-3 py-2 text-sm"
            >
              Too many attempts — try again after {lockedUntil}.
            </p>
          ) : failed ? (
            <p
              role="alert"
              className="border-destructive bg-destructive-soft text-destructive rounded-md border px-3 py-2 text-sm"
            >
              Incorrect username or password.
            </p>
          ) : passwordNeeded ? (
            <p role="status" className="bg-secondary text-secondary-foreground rounded-md px-3 py-2 text-sm">
              {PASSWORD_NEEDED_TEXT}
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
              defaultValue={prefill}
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
              autoFocus={passwordNeeded && prefill !== ""}
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
