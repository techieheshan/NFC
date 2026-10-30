import { Fragment, type ReactNode } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * One data set, two shapes: a real table from the breakpoint up, and a list of
 * cards below it.
 *
 * Why: a wide table on a 360px terminal either scrolls sideways inside its box
 * or, worse, pushes the whole page wider — which also drags every dialog off
 * centre, because a `position: fixed` box spans the layout viewport. A card per
 * row has no width to overflow.
 *
 * The columns are declared ONCE. The table renders them as columns; the card
 * renders the `primary` one as its title and the rest as label/value lines, or
 * `renderCard` takes over entirely for a row that deserves a custom layout.
 *
 * No JavaScript and no hooks, so it can be rendered from a server component, and
 * which shape shows is decided by CSS alone (no hydration mismatch). The price is
 * that BOTH shapes are in the DOM, so use it for lists of a few hundred rows at
 * most; anything longer wants pagination first.
 *
 * Nothing here uses `:has()`, container queries or newer viewport units: it has
 * to work on Chrome 102.
 */
export type DataColumn<T> = {
  key: string;
  header: ReactNode;
  cell: (item: T) => ReactNode;
  /** Right-align in the table (numbers, money). */
  align?: "left" | "right";
  /** The card's title. The first column is used when none is marked. */
  primary?: boolean;
  /** Leave this column out of the card (it only repeats the title, say). */
  hideInCard?: boolean;
  /** Table only: extra classes for the header and the cells, e.g. a max width. */
  className?: string;
};

type Breakpoint = "sm" | "md" | "lg" | "xl";

// Full class names, written out, because Tailwind finds classes by scanning the
// source and would never see `${breakpoint}:block` built at runtime.
const SHAPES: Record<Breakpoint, { table: string; cards: string }> = {
  sm: { table: "hidden sm:block", cards: "sm:hidden" },
  md: { table: "hidden md:block", cards: "md:hidden" },
  lg: { table: "hidden lg:block", cards: "lg:hidden" },
  xl: { table: "hidden xl:block", cards: "xl:hidden" },
};

export function ResponsiveDataList<T>({
  items,
  columns,
  getKey,
  renderCard,
  breakpoint = "md",
  empty,
  label,
  className,
}: {
  items: readonly T[];
  columns: readonly DataColumn<T>[];
  getKey: (item: T) => string | number;
  /** Replace the default card for a row. Receives the same item. */
  renderCard?: (item: T) => ReactNode;
  /** Where the table takes over from the cards. Default `md` (768px). */
  breakpoint?: Breakpoint;
  /** Shown instead of either shape when there are no rows. */
  empty?: ReactNode;
  /** Names the list for assistive tech. */
  label?: string;
  className?: string;
}) {
  if (items.length === 0) return empty ? <>{empty}</> : null;

  const shapes = SHAPES[breakpoint];
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const rest = columns.filter((c) => c !== primary && !c.hideInCard);

  return (
    <div className={className}>
      <div className={cn("rounded-xl border", shapes.table)}>
        <Table aria-label={label}>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <TableHead key={c.key} className={cn(c.align === "right" && "text-right", c.className)}>
                  {c.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={getKey(item)}>
                {columns.map((c) => (
                  <TableCell key={c.key} className={cn(c.align === "right" && "text-right tabular-nums", c.className)}>
                    {c.cell(item)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className={cn("space-y-2", shapes.cards)} aria-label={label}>
        {items.map((item) => (
          <li key={getKey(item)}>
            {renderCard ? (
              renderCard(item)
            ) : (
              <div className="bg-card rounded-xl border p-3">
                <div className="font-medium break-words">{primary.cell(item)}</div>
                {rest.length > 0 && (
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                    {rest.map((c) => (
                      <Fragment key={c.key}>
                        <dt className="text-muted-foreground">{c.header}</dt>
                        <dd className="min-w-0 text-right break-words tabular-nums">{c.cell(item)}</dd>
                      </Fragment>
                    ))}
                  </dl>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
