"use client";

/**
 * PDF export.
 *
 * jsPDF is ~350KB, so it is pulled in with a dynamic import the moment the
 * button is pressed and never ships in the initial bundle — these reports are
 * reachable from the terminal shell too.
 */
export type PdfTable = {
  title?: string;
  head: string[];
  body: (string | number)[][];
};

export async function downloadReportPdf(options: {
  filename: string;
  title: string;
  subtitle: string;
  tables: PdfTable[];
}): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

  doc.setFontSize(16);
  doc.text(options.title, 40, 40);
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text(options.subtitle, 40, 58);
  doc.setTextColor(0);

  let y = 78;
  for (const table of options.tables) {
    if (table.title) {
      doc.setFontSize(11);
      doc.text(table.title, 40, y + 12);
      y += 20;
    }
    autoTable(doc, {
      head: [table.head],
      body: table.body.map((r) => r.map(String)),
      startY: y,
      margin: { left: 40, right: 40 },
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [124, 58, 237], textColor: 255 },
      alternateRowStyles: { fillColor: [248, 246, 252] },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;
  }

  doc.save(options.filename);
}
