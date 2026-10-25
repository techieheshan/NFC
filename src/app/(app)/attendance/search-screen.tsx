"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { AttenderHit } from "./actions";
import { PaymentChip, StudentFace } from "./result-panel";

/**
 * E. Find a student by hand.
 *
 * The way in when the card is at home, forgotten or broken. It is its own
 * screen rather than a box under the reader: the reader is PAUSED while this is
 * open (staff are typing, not tapping), and the terminal must never show two
 * ways to identify the same student at once.
 *
 * Type-ahead, debounced, over the same `searchStudentsQuery` the Payment screen
 * uses — one search behaviour in the app, not two.
 */
const DEBOUNCE_MS = 250;

export function SearchScreen({
  search,
  onPick,
  onBack,
}: {
  search: (query: string) => Promise<AttenderHit[]>;
  onPick: (hit: AttenderHit) => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  /**
   * The rows and the query they belong to, in ONE piece of state.
   *
   * Rows are derived from it rather than cleared on every keystroke: a reply
   * that arrives late belongs to an older query and is simply not shown, and
   * nothing has to be synced back into state to make that true.
   */
  const [data, setData] = useState<{ q: string; items: AttenderHit[] }>({ q: "", items: [] });
  const [pending, setPending] = useState(false);
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => {
    box.current?.focus();
  }, []);

  useEffect(() => {
    const typed = query.trim();
    if (typed.length < 2) return;

    // One timer per keystroke, and a `live` flag so a reply that arrives after
    // the component moved on is dropped.
    let live = true;
    const timer = setTimeout(() => {
      setPending(true);
      void search(typed)
        .then((rows) => {
          if (live) setData({ q: typed, items: rows });
        })
        .catch(() => {
          if (live) setData({ q: typed, items: [] });
        })
        .finally(() => {
          if (live) setPending(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, search]);

  const q = query.trim();
  const hits = q.length >= 2 && data.q === q ? data.items : [];
  const settled = data.q === q;

  return (
    <div className="space-y-3">
      {/* The screen's own back arrow. The app's menu stays where it is — one
          menu, in the shell; this only backs out of the search view. */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to the reader">
          <ChevronLeft className="size-6" aria-hidden />
        </Button>
        <p className="font-semibold">Find a student</p>
      </div>

      <div className="relative">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-0 bottom-0 left-3 my-auto size-4"
          aria-hidden
        />
        <Input
          ref={box}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name, school, or last digits of the card"
          className="h-12 pr-10 pl-9 text-base"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          inputMode="search"
          aria-label="Search for a student"
        />
        {query !== "" && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute top-0 right-1.5 bottom-0 my-auto"
            onClick={() => {
              setQuery("");
              box.current?.focus();
            }}
            aria-label="Clear the search"
          >
            <X className="size-4" aria-hidden />
          </Button>
        )}
      </div>

      {q.length < 2 && (
        <p className="text-muted-foreground px-1 text-sm">
          Type at least two letters or digits.
        </p>
      )}

      {q.length >= 2 && hits.length === 0 && !pending && settled && (
        <p className="text-muted-foreground px-1 text-sm">
          Nobody matches “{q}”.
        </p>
      )}

      {pending && hits.length === 0 && (
        <p className="text-muted-foreground px-1 text-sm">Searching…</p>
      )}

      <ul className="space-y-2">
        {hits.map((hit) => (
          <li key={hit.id}>
            {/* min-h-12: a thumb's target on a POS terminal, not a mouse's. */}
            <button
              type="button"
              onClick={() => onPick(hit)}
              className="hover:bg-accent bg-card flex min-h-12 w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-colors"
            >
              <StudentFace
                photoUrl={hit.photoUrl}
                name={hit.name}
                cardNumber={hit.cardNumber}
                size="md"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{hit.name}</span>
                <span className="text-muted-foreground block truncate font-mono text-xs">
                  {hit.cardNumber ?? "no card number"}
                </span>
                {hit.school && (
                  <span className="text-muted-foreground block truncate text-xs">
                    {hit.school}
                  </span>
                )}
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  <PaymentChip arrears={hit.arrears} size="sm" />
                  {hit.classes.slice(0, 1).map((c) => (
                    <Badge key={c} variant="secondary" className="block min-w-0 max-w-full truncate">
                      {c}
                    </Badge>
                  ))}
                </span>
              </span>
              <ChevronRight className="text-muted-foreground size-5 shrink-0" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
