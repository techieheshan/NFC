import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";

import { ChangePasswordForm } from "./change-password-form";

export const metadata = { title: "Change password" };

/**
 * Deliberately OUTSIDE the (app) group.
 *
 * The app layout sends anyone flagged `mustChangePassword` here, so if this
 * page lived inside that layout it would redirect to itself forever.
 */
export default async function ChangePasswordPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const forced = session.user.mustChangePassword;

  return (
    <div className="from-primary/10 flex min-h-svh items-center justify-center bg-gradient-to-b to-transparent px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="bg-primary text-primary-foreground grid size-12 place-items-center rounded-xl text-lg font-bold">
            X
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {forced ? "Set your password" : "Change your password"}
            </h1>
            <p className="text-muted-foreground text-sm">
              Signed in as {session.user.username}
            </p>
          </div>
        </div>

        <ChangePasswordForm forced={forced} />

        {!forced && (
          <p className="text-muted-foreground mt-4 text-center text-sm">
            <Link href="/" className="underline underline-offset-4">
              Back to Xenon
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
