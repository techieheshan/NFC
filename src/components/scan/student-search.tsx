"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, Search, UserRound } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { StudentBrief } from "@/lib/students";

/**
 * Typeahead fallback for when a card can't be read at all.
 *
 * Matches a fragment of card number, name or school, so staff can type just the
 * part that changes ("2000") instead of the whole "0186-0001-2000". The photo
 * and card number are shown because names repeat within a grade.
 */
export function StudentSearch({
  onPick,
  search,
  busy,
}: {
  onPick: (student: StudentBrief) => void;
  search: (query: string) => Promise<StudentBrief[]>;
  busy: boolean;
}) {
  const [query, setQuery] = useState("");
  // Results are stored with the query that produced them, so a stale response
  // is never rendered against different input — and nothing has to be cleared
  // from inside the effect.
  const [data, setData] = useState<{ q: string; items: StudentBrief[] }>({
    q: "",
    items: [],
  });
  const [pending, startTransition] = useTransition();

  const q = query.trim();

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) return;

    // Debounced: a terminal on a slow link shouldn't fire a query per keypress.
    const timer = setTimeout(() => {
      startTransition(async () => setData({ q: term, items: await search(term) }));
    }, 250);

    return () => clearTimeout(timer);
  }, [query, search]);

  const results = data.q === q ? data.items : [];

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="student-search">Search by number, name or school</Label>
        <div className="relative">
          <Search
            className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            id="student-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. 2000, Nimal, Royal College"
            className="pl-9"
            autoComplete="off"
            disabled={busy}
          />
          {pending && (
            <Loader2
              className="text-muted-foreground absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin"
              aria-hidden
            />
          )}
        </div>
      </div>

      {q.length >= 2 && results.length === 0 && !pending && (
        <p className="text-muted-foreground text-sm">No students match that.</p>
      )}

      {results.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-xl border">
          {results.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onPick(s)}
                disabled={busy}
                className="hover:bg-accent flex w-full items-center gap-3 p-3 text-left transition-colors disabled:opacity-50"
              >
                <span className="bg-muted size-10 shrink-0 overflow-hidden rounded-full">
                  {s.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.photoUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <span className="text-muted-foreground grid size-full place-items-center">
                      <UserRound className="size-5" aria-hidden />
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.name}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {s.cardNumber ?? "no card number"}
                    {s.school ? ` · ${s.school}` : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
