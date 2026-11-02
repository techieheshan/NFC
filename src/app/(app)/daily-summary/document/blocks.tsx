import type { ReactNode } from "react";

import type { Placement } from "@/lib/paginate";

import { ADMISSION_NOTE, smartCardLabel } from "../extra-lines";
import type { DocModel } from "./model";

/**
 * The sheet's blocks, as React. The SAME components render in the hidden measuring container (whole) and on
 * the real sheets (a block, or a slice of a table's rows), so a measured height is the height that gets
 * printed. Plain classes from document.css; no Tailwind utilities, no oklch colours.
 */

export type DocBlockDef = {
  id: string;
  /** A table block can be split between rows; a plain block cannot. */
  table: boolean;
  render: (slice?: Placement) => ReactNode;
};

type Col = { label: string; w: number; right?: boolean };

function DocTable({
  id, title, cols, rows, foot, note, slice,
}: {
  id: string;
  title: string;
  cols: Col[];
  rows: ReactNode[][];
  foot?: ReactNode[];
  note?: ReactNode;
  slice?: Placement;
}) {
  const a = slice?.rowStart ?? 0;
  const b = slice?.rowEnd ?? rows.length;
  const showTail = !slice || slice.last;
  return (
    <section className="ds-sec" data-block={id}>
      {slice?.continued ? <p className="ds-cont">{title} (continued)</p> : <h3 className="ds-h">{title}</h3>}
      <table className="ds-table">
        <colgroup>{cols.map((c, i) => <col key={i} style={{ width: c.w }} />)}</colgroup>
        <thead data-part="thead">
          <tr>{cols.map((c, i) => <th key={i} className={c.right ? "r" : undefined}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(a, b).map((r, i) => (
            <tr key={a + i} data-row>
              {r.map((cell, j) => <td key={j} className={cols[j].right ? "r" : undefined}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
        {showTail && foot && (
          <tfoot>
            <tr>{foot.map((cell, j) => <td key={j} className={cols[j].right ? "r" : undefined}>{cell}</td>)}</tr>
          </tfoot>
        )}
      </table>
      {showTail && note && <p className="ds-note">{note}</p>}
    </section>
  );
}

const Kv = ({ label, value, cls }: { label: ReactNode; value: ReactNode; cls?: string }) => (
  <div className={`ds-kv${cls ? ` ${cls}` : ""}`}>
    <span>{label}</span>
    <span>{value}</span>
  </div>
);

function Header({ m }: { m: DocModel }) {
  const day = m.kind === "day";
  return (
    <section className="ds-sec" data-block="header">
      <div className="ds-head">
        <div className="ds-logo">
          <div className="ds-x">X</div>
          <div>
            <div className="ds-word">XENON</div>
            <div className="ds-inst">INSTITUTE</div>
          </div>
        </div>
        <div className="ds-title">
          <b>Daily Summary</b>
          <span>{day ? "Collection and cash book" : "Collection, several days"}</span>
        </div>
      </div>
      <div className="ds-rule" />
      <div className="ds-info">
        {day ? (
          <>
            <div>
              <div><span>Date</span><b>{m.dateText}</b></div>
              <div><span>Prepared by</span><b>{m.preparedBy}</b></div>
              <div><span>Checked by (admin)</span><b>{m.checkedBy}</b></div>
              <div><span>Document no.</span><b>{m.docNo}</b></div>
            </div>
            <div>
              <div><span>Status</span><b>Draft, not saved</b></div>
              <div><span>Generated</span><b>{m.generatedText} by {m.generatedBy}</b></div>
            </div>
          </>
        ) : (
          <>
            <div>
              <div><span>From</span><b>{m.from}</b></div>
              <div><span>To</span><b>{m.to}</b></div>
            </div>
            <div>
              <div><span>Generated</span><b>{m.generatedText} by {m.generatedBy}</b></div>
              <div><span>Document no.</span><b>{m.docNo}</b></div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function IncomeBlock({ m }: { m: DocModel }) {
  const f = m.flow;
  return (
    <section className="ds-sec" data-block="income">
      <div className={f ? "ds-two" : undefined}>
        <div>
          <h3 className="ds-h">{f ? "2 Income and totals" : "Income and totals"}</h3>
          <Kv label="Class fees" value={m.classFees} />
          {m.ofWhich.map((l) => <Kv key={l.key} cls="sub" label={l.label} value={l.total} />)}
          <Kv label={`Admission (${m.admission.count})`} value={m.admission.total} />
          <Kv cls="sub" label={ADMISSION_NOTE} value="" />
          <Kv label={smartCardLabel(m.smartCard.count)} value={m.smartCard.total} />
          <Kv cls="strong" label="Total collected" value={m.totalCollected} />
          <Kv label="Teacher advances" value={m.teacherAdvances} />
          <Kv label="Xenon expenses" value={m.xenonExpenses} />
          <Kv cls="strong" label="Net" value={m.net} />
          <p className="ds-note">Staff advances are inside Xenon expenses and counted once.</p>
        </div>
        {f && (
          <div>
            <h3 className="ds-h">3 Cash book</h3>
            <Kv label="Bring-forward" value={f.bringForward} />
            <Kv label="+ Collected" value={f.collected} />
            <Kv label="− Deductions" value={f.deductions} />
            <Kv cls="strong" label="Should be in the drawer" value={f.shouldBe} />
            <Kv label={`− Taken to bank (${f.bankCount})`} value={f.bankTotal} />
            <div className="ds-box"><Kv label="Left in drawer" value={f.left} /></div>
            <p className="ds-note">
              All money collected is cash. Bank deposits are listed below. The amount left in the drawer is
              tomorrow&rsquo;s bring-forward.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function Signatures({ m }: { m: DocModel }) {
  const box = (who: string, name: string | null) => (
    <div className="ds-sigbox">
      <div className="who">{who}</div>
      <div className="name">{name}</div>
      <div className="ds-sigline"><div>Signature</div><div>Date</div></div>
    </div>
  );
  return (
    <section className="ds-sec" data-block="signatures">
      <h3 className="ds-h">7 Signatures</h3>
      <div className="ds-sig">
        {box("Prepared by", m.preparedBy)}
        {box("Checked by (admin)", m.checkedBy)}
      </div>
    </section>
  );
}

const NONE = (n: number, text: string): ReactNode[] => [text, ...Array.from({ length: n - 1 }, () => "")];

export function makeBlocks(m: DocModel): DocBlockDef[] {
  const day = m.kind === "day";
  const blocks: DocBlockDef[] = [{ id: "header", table: false, render: () => <Header m={m} /> }];

  if (!day) {
    blocks.push({
      id: "dayByDay", table: true,
      render: (s) => (
        <DocTable id="dayByDay" title="Day by day" slice={s}
          cols={[{ label: "Day", w: 214 }, { label: "Collected", w: 166, right: true }, { label: "Deductions", w: 166, right: true }, { label: "Net", w: 168, right: true }]}
          rows={m.dayByDay.map((d) => [d.date, d.collected, d.deductions, d.net])}
          foot={["Total", m.dayByDayTotal!.collected, m.dayByDayTotal!.deductions, m.dayByDayTotal!.net]} />
      ),
    });
  }

  blocks.push({
    id: "courses", table: true,
    render: (s) => (
      <DocTable id="courses" title={day ? "1 Collection by course" : "Collection by course"} slice={s}
        cols={[{ label: "Course", w: 210 }, { label: "Teacher", w: 150 }, { label: "Paid", w: 44, right: true }, { label: "Full", w: 44, right: true },
          { label: "Half", w: 44, right: true }, { label: "25%", w: 44, right: true }, { label: "Free", w: 44, right: true }, { label: "Amount (Rs.)", w: 134, right: true }]}
        rows={m.courses.length === 0
          ? [NONE(8, "No payments")]
          : m.courses.map((c) => [c.course, c.teacher, c.paid, c.full, c.half, c.quarter, c.free, c.amount])}
        foot={["Class fees", "", "", "", "", "", "", m.classFees]}
        note={
          <>
            {m.noPaymentCourses.length > 0 && <>No payments: {m.noPaymentCourses.join(", ")}. </>}
            Half is the Half fee tier.
            {m.includedNote && <> {m.includedNote}</>}
          </>
        } />
    ),
  });

  blocks.push({ id: "income", table: false, render: () => <IncomeBlock m={m} /> });

  blocks.push({
    id: "deductions", table: true,
    render: (s) => (
      <DocTable id="deductions" title={day ? "4 Deductions: what and on whose authority" : "Deductions: what and on whose authority"} slice={s}
        cols={[{ label: "Date", w: 92 }, { label: "Kind", w: 100 }, { label: "Person", w: 126 }, { label: "Reason", w: 150 }, { label: "Authorised by", w: 126 }, { label: "Amount", w: 120, right: true }]}
        rows={m.deductions.length === 0
          ? [NONE(6, "No deductions")]
          : m.deductions.map((d) => [d.date, d.kind, d.person, d.reason, d.authorizedBy, d.amount])} />
    ),
  });

  if (day && m.bank.length > 0) {
    blocks.push({
      id: "bank", table: true,
      render: (s) => (
        <DocTable id="bank" title="5 Money taken to the bank" slice={s}
          cols={[{ label: "Time", w: 90 }, { label: "Bank slip no.", w: 150 }, { label: "Note", w: 354 }, { label: "Amount", w: 120, right: true }]}
          rows={m.bank.map((l) => [l.time, l.slip, l.note, l.amount])}
          foot={["Total", "", "", m.bankTotal]} />
      ),
    });
  }

  if (day) {
    blocks.push({
      id: "staff", table: true,
      render: (s) => (
        <DocTable id="staff" title="6 Collected by staff" slice={s}
          cols={[{ label: "Staff", w: 354 }, { label: "Receipts", w: 120, right: true }, { label: "Collected", w: 240, right: true }]}
          rows={m.staff.length === 0 ? [NONE(3, "No receipts")] : m.staff.map((r) => [r.name, r.receipts, r.collected])}
          foot={["Total", m.staffTotal.receipts, m.staffTotal.collected]} />
      ),
    });
  }

  if (m.cancelledLine) {
    blocks.push({ id: "cancelled", table: false, render: () => <section className="ds-sec" data-block="cancelled"><p className="ds-note" style={{ marginTop: 0 }}>{m.cancelledLine}</p></section> });
  }
  if (day) blocks.push({ id: "signatures", table: false, render: () => <Signatures m={m} /> });
  return blocks;
}
