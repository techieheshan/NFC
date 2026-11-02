import type { Page } from "@/lib/paginate";

import { overflowWarning } from "./paginate-document";

/** The visible warning (not printed) when a page reports overflow. Presentational: renders in the view and in a test alike. */
export function OverflowNotice({ pages }: { pages: readonly Page[] }) {
  const text = overflowWarning(pages);
  if (!text) return null;
  return (
    <p role="alert" className="no-print rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      {text}
    </p>
  );
}
