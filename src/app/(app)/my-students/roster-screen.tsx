"use client";

import { useState } from "react";
import { Download, Users } from "lucide-react";

import { downloadReportPdf } from "@/components/reports/report-pdf";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { RosterCourse } from "@/lib/roster";

/**
 * Renders the roster the server already scoped. The PDF is built from these
 * same rows, which is what makes a teacher's export contain only their own
 * courses — there is no second, wider fetch behind the download button.
 */
export function RosterScreen({
  courses,
  filterSummary,
  showPhone,
}: {
  courses: RosterCourse[];
  filterSummary: string;
  /** One flag, so dropping contact numbers from the whole screen is one edit. */
  showPhone: boolean;
}) {
  const [exporting, setExporting] = useState(false);

  const total = courses.reduce((n, c) => n + c.students.length, 0);

  async function exportPdf() {
    setExporting(true);
    try {
      await downloadReportPdf({
        filename: `xenon-my-students-${new Date().toISOString().slice(0, 10)}.pdf`,
        title: "Class rosters",
        subtitle: filterSummary,
        tables: courses.map((c) => ({
          title: `${c.course} — ${c.students.length} ${c.students.length === 1 ? "student" : "students"}`,
          head: ["Name", "Card number", "Grade", "School", "Fee tier", ...(showPhone ? ["Phone"] : [])],
          body: c.students.map((s) => [
            s.dropped ? `${s.name} (dropped)` : s.name,
            s.cardNumber ?? "—",
            s.grade,
            s.school ?? "—",
            s.feeTier,
            ...(showPhone ? [s.phone ?? "—"] : []),
          ]),
        })),
      });
    } finally {
      setExporting(false);
    }
  }

  if (courses.length === 0) {
    return (
      <p className="bg-secondary text-secondary-foreground rounded-lg px-4 py-3 text-sm">
        No courses to show.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {courses.length} {courses.length === 1 ? "course" : "courses"} · {total}{" "}
          {total === 1 ? "enrolment" : "enrolments"}
        </p>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={exportPdf} disabled={exporting}>
          <Download className="size-3.5" aria-hidden />
          {exporting ? "Preparing…" : "Download PDF"}
        </Button>
      </div>

      {courses.map((c) => (
        <section key={c.courseId} className="rounded-xl border">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
            <div>
              <h2 className="font-medium">{c.course}</h2>
              <p className="text-muted-foreground text-sm">{c.teacher}</p>
            </div>
            <Badge variant="secondary" className="gap-1.5">
              <Users className="size-3.5" aria-hidden />
              {c.students.length}
            </Badge>
          </header>

          {c.students.length === 0 ? (
            <p className="text-muted-foreground p-4 text-sm">Nobody enrolled.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-b text-left">
                  <tr>
                    <th className="p-3 font-medium">Name</th>
                    <th className="p-3 font-medium">Card number</th>
                    <th className="p-3 font-medium">Grade</th>
                    <th className="p-3 font-medium">School</th>
                    <th className="p-3 font-medium">Fee tier</th>
                    {showPhone && <th className="p-3 font-medium">Phone</th>}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {c.students.map((s) => (
                    <tr key={s.id}>
                      <td className="p-3">
                        {s.name}
                        {s.dropped && (
                          <Badge variant="outline" className="ml-2">Dropped</Badge>
                        )}
                      </td>
                      <td className="p-3 font-mono">{s.cardNumber ?? "—"}</td>
                      <td className="p-3">{s.grade}</td>
                      <td className="p-3">{s.school ?? "—"}</td>
                      <td className="p-3">{s.feeTier}</td>
                      {showPhone && <td className="p-3">{s.phone ?? "—"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
