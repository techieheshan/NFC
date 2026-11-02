"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Block, Page } from "@/lib/paginate";

import { makeBlocks, type DocBlockDef } from "./blocks";
import { DOCUMENT_CSS } from "./document-css";
import type { DocModel } from "./model";
import { downloadPdf } from "./download-pdf";
import { sheetsToPdf } from "./make-pdf";
import { OverflowNotice } from "./overflow-notice";
import { paginateDocument } from "./paginate-document";


const CONT_LABEL = 22; // the "(continued)" line above a repeated header

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

function measure(root: HTMLElement, defs: DocBlockDef[]): Block[] {
  return defs.map((def) => {
    const el = root.querySelector<HTMLElement>(`[data-block="${def.id}"]`);
    if (!el) return { id: def.id, height: 0 };
    const r = el.getBoundingClientRect();
    const mb = parseFloat(getComputedStyle(el).marginBottom) || 0;
    const height = Math.ceil(r.height + mb);
    const rows = [...el.querySelectorAll<HTMLElement>("[data-row]")];
    if (!def.table || rows.length === 0) return { id: def.id, height };
    const rects = rows.map((x) => x.getBoundingClientRect());
    const thead = el.querySelector<HTMLElement>('[data-part="thead"]')?.getBoundingClientRect().height ?? 0;
    return {
      id: def.id,
      height,
      table: {
        top: Math.ceil(rects[0].top - r.top),
        contTop: Math.ceil(thead) + CONT_LABEL,
        rows: rects.map((x) => Math.ceil(x.height)),
        bottom: Math.ceil(r.bottom + mb - rects[rects.length - 1].bottom),
      },
    };
  });
}

export function DocumentView({
  model, filename, backHref, auto, blocked,
}: {
  model: DocModel;
  filename: string;
  backHref: string;
  /** "print" or "pdf": run once, as soon as the pages are ready (the main screen's buttons open this page that way). */
  auto: "print" | "pdf" | null;
  /** When set, nothing is shown to print: the reason is. */
  blocked: string | null;
}) {
  const defs = useMemo(() => makeBlocks(model), [model]);
  const [pages, setPages] = useState<Page[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const sheetsRef = useRef<HTMLDivElement>(null);
  const ran = useRef(false);

  // Measure after the fonts are ready (a Sinhala line wraps differently from a Latin one), then fill the sheets.
  useEffect(() => {
    if (blocked) return;
    let live = true;
    (async () => {
      await document.fonts.ready;
      await frame();
      await document.fonts.ready;
      await frame();
      if (!live || !measureRef.current) return;
      setPages(paginateDocument(measure(measureRef.current, defs)));
    })();
    return () => {
      live = false;
    };
  }, [defs, blocked]);

  const doPrint = () => window.print();
  const doPdf = async () => {
    if (!sheetsRef.current || busy) return;
    setBusy(true);
    setError(null);
    window.scrollTo(0, 0);
    // null when the PDF was made; the one agreed sentence when it was not, whatever the reason (fonts, deadline, memory)
    const problem = await downloadPdf(() => sheetsToPdf([...sheetsRef.current!.querySelectorAll<HTMLElement>(".ds-sheet")], filename));
    setError(problem);
    setBusy(false);
  };

  // The main screen's Print / Download PDF open this page with ?auto=…: run it once the sheets are on screen.
  useEffect(() => {
    if (!pages || !auto || ran.current) return;
    ran.current = true;
    (async () => {
      await frame();
      await frame();
      try {
        const u = new URL(window.location.href);
        u.searchParams.delete("auto");
        window.history.replaceState(null, "", u);
      } catch {
        /* the address bar is cosmetic */
      }
      if (auto === "print") doPrint();
      else await doPdf();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, auto]);

  const total = pages?.length ?? 0;

  return (
    <div className="ds-doc mx-auto max-w-4xl space-y-4">
      <style>{DOCUMENT_CSS}</style>
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost">
          <Link href={backHref}><ArrowLeft className="size-4" aria-hidden /> Back</Link>
        </Button>
        {!blocked && (
          <div className="flex items-center gap-2">
            <Button variant="outline" className="gap-2" onClick={doPrint} disabled={!pages}>
              <Printer className="size-4" aria-hidden /> Print
            </Button>
            <Button className="gap-2" onClick={doPdf} disabled={!pages || busy}>
              <Download className="size-4" aria-hidden /> {busy ? "Preparing…" : "Download PDF"}
            </Button>
          </div>
        )}
      </div>

      {blocked ? (
        <p role="alert" className="no-print rounded-xl border border-dashed p-6 text-center text-sm">{blocked}</p>
      ) : (
        <>
          <p className="no-print text-muted-foreground text-sm">
            {pages ? `${total} A4 page${total === 1 ? "" : "s"}. The page scrolls sideways inside the grey box.` : "Preparing pages…"}
          </p>
          {error && <p role="alert" className="no-print text-destructive text-sm">{error}</p>}
          {pages && <OverflowNotice pages={pages} />}

          {!pages && (
            <div ref={measureRef} className="ds-measure" aria-hidden>
              {defs.map((d) => <div key={d.id}>{d.render()}</div>)}
            </div>
          )}

          {pages && (
            <div className="ds-preview">
              <div ref={sheetsRef} className="ds-pages">
                {pages.map((p, i) => (
                  <div key={i} className="ds-sheet" data-sheet>
                    {p.placements.map((pl) => {
                      const def = defs.find((d) => d.id === pl.blockId)!;
                      return <div key={`${pl.blockId}-${pl.rowStart ?? 0}`}>{def.render(pl.rowStart === undefined ? undefined : pl)}</div>;
                    })}
                    <div className="ds-foot">
                      <span>Generated {model.generatedText} by {model.generatedBy} · {model.docNo} · Draft</span>
                      <span>Page {i + 1} of {total}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
