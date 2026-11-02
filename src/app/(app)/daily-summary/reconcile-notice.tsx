import { AlertTriangle } from "lucide-react";

/**
 * The reconcile warning (`reconcileWarning` in extra-lines.ts), as the day screen and the range screen both show it:
 * one component, so the two screens and their documents say the same thing. Nothing here has state, so it renders on
 * the server and in the client alike.
 */
export function ReconcileNotice({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="min-w-0">{text}</span>
    </p>
  );
}
