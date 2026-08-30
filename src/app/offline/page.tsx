import Link from "next/link";
import { CloudOff, ScanLine } from "lucide-react";

export const metadata = { title: "No connection" };

/**
 * What the service worker serves for any route that is NOT attendance when the
 * network is down.
 *
 * Deliberately outside the (app) group and outside the proxy matcher: it has to
 * render with no session and no server, because by the time it is shown there
 * is neither. It queues nothing — only attendance does.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-svh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6 text-center">
        <span className="bg-secondary text-secondary-foreground mx-auto grid size-16 place-items-center rounded-full">
          <CloudOff className="size-8" aria-hidden />
        </span>

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">No connection</h1>
          <p className="text-muted-foreground text-sm">
            This screen needs the server. Registration, payments and reports are
            not stored on this device — nothing is queued, so nothing is lost;
            reopen it once the connection is back.
          </p>
        </div>

        <div className="space-y-3 rounded-xl border p-4 text-left">
          <p className="flex items-center gap-2 text-sm font-medium">
            <ScanLine className="size-4" aria-hidden />
            Attendance still works offline
          </p>
          <p className="text-muted-foreground text-sm">
            Marks taken there are saved on this device and sync themselves when
            the connection returns.
          </p>
          <Link
            href="/attendance"
            className="bg-primary text-primary-foreground inline-flex h-9 w-full items-center justify-center rounded-md px-4 text-sm font-medium"
          >
            Go to Attendance
          </Link>
        </div>
      </div>
    </div>
  );
}
