import Link from "next/link";
import type { PaymentKind } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { colomboNow } from "@/lib/colombo-time";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";
import {
  hasPaymentFilter,
  hasStudentFilter,
  searchPayments,
  searchStudents,
  type PaymentFilters,
  type StudentFilters,
} from "@/lib/search";

import { SearchResults } from "./search-screen";

export const metadata = { title: "Search" };

const FIELD =
  "border-input bg-background h-9 rounded-md border px-3 py-1 text-sm shadow-xs";

function toStr(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.trim() !== "" ? raw.trim() : undefined;
}

function toId(value: string | string[] | undefined): number | undefined {
  const n = Number(toStr(value));
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

const KINDS: PaymentKind[] = ["ADMISSION", "SMART_CARD", "CLASS"];

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  // ADMIN + STAFF, from the nav config. Read-only screen: nothing here writes.
  await requireNavAccess("/search");

  const params = await searchParams;
  const tab = toStr(params.tab) === "payments" ? "payments" : "students";

  const studentFilters: StudentFilters = {
    card: toStr(params.card),
    name: toStr(params.name),
    school: toStr(params.school),
    gradeId: toId(params.gradeId),
    nic: toStr(params.nic),
  };

  const kindParam = toStr(params.kind);
  const paymentFilters: PaymentFilters = {
    student: toStr(params.student),
    from: toStr(params.from),
    to: toStr(params.to),
    courseId: toId(params.courseId),
    kind: KINDS.includes(kindParam as PaymentKind) ? (kindParam as PaymentKind) : undefined,
    includeCancelled: toStr(params.cancelled) === "1",
  };

  const [students, payments, grades, courses] = await Promise.all([
    tab === "students" ? searchStudents(studentFilters) : Promise.resolve([]),
    tab === "payments" ? searchPayments(paymentFilters) : Promise.resolve([]),
    db.grade.findMany({ where: { active: true }, select: { id: true, label: true }, orderBy: { label: "asc" } }),
    db.course.findMany({
      where: { active: true },
      select: {
        id: true, name: true,
        grade: { select: { label: true } },
        subject: { select: { label: true } },
        classType: { select: { label: true } },
        teacher: { select: { name: true } },
      },
      orderBy: { id: "asc" },
    }),
  ]);

  const searched = tab === "students" ? hasStudentFilter(studentFilters) : hasPaymentFilter(paymentFilters);
  const today = colomboNow().date;

  const filterSummary =
    tab === "students"
      ? [
          studentFilters.card && `card ~ "${studentFilters.card}"`,
          studentFilters.name && `name ~ "${studentFilters.name}"`,
          studentFilters.school && `school ~ "${studentFilters.school}"`,
          studentFilters.gradeId && `grade = ${grades.find((g) => g.id === studentFilters.gradeId)?.label}`,
          studentFilters.nic && `NIC ~ "${studentFilters.nic}"`,
        ].filter(Boolean).join(" · ") || "no filters"
      : [
          paymentFilters.student && `student ~ "${paymentFilters.student}"`,
          paymentFilters.from && paymentFilters.to && `${paymentFilters.from} to ${paymentFilters.to} (Asia/Colombo)`,
          paymentFilters.courseId &&
            `course = ${courses.filter((c) => c.id === paymentFilters.courseId).map(courseDisplayName)[0]}`,
          paymentFilters.kind && `kind = ${paymentFilters.kind}`,
          paymentFilters.includeCancelled ? "cancelled included" : "cancelled excluded",
        ].filter(Boolean).join(" · ");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Read-only. Card numbers match on any part, so the last few printed
          digits are enough.
        </p>
      </div>

      <div className="flex gap-2">
        <Button asChild variant={tab === "students" ? "default" : "outline"} size="sm">
          <Link href="/search?tab=students">Students</Link>
        </Button>
        <Button asChild variant={tab === "payments" ? "default" : "outline"} size="sm">
          <Link href="/search?tab=payments">Payments</Link>
        </Button>
      </div>

      {/* Plain GET forms: filters are searchParams, so a search is a fresh
          server render and the URL is shareable. Works before hydration. */}
      {tab === "students" ? (
        <form className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
          <input type="hidden" name="tab" value="students" />
          <Field id="card" label="Card number (any part)" defaultValue={studentFilters.card} placeholder="e.g. 0007" />
          <Field id="name" label="Name" defaultValue={studentFilters.name} />
          <Field id="school" label="School" defaultValue={studentFilters.school} />
          <div className="space-y-2">
            <label htmlFor="gradeId" className="block text-sm font-medium">Grade</label>
            <select id="gradeId" name="gradeId" className={`${FIELD} w-full`} defaultValue={studentFilters.gradeId ?? ""}>
              <option value="">Any grade</option>
              {grades.map((g) => (
                <option key={g.id} value={g.id}>{g.label}</option>
              ))}
            </select>
          </div>
          <Field id="nic" label="NIC" defaultValue={studentFilters.nic} />
          <div className="flex items-end gap-2">
            <Button type="submit">Search</Button>
            {searched && (
              <Button asChild variant="ghost">
                <Link href="/search?tab=students">Clear</Link>
              </Button>
            )}
          </div>
        </form>
      ) : (
        <form className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
          <input type="hidden" name="tab" value="payments" />
          <Field id="student" label="Student (card number or name)" defaultValue={paymentFilters.student} />
          <div className="space-y-2">
            <label htmlFor="kind" className="block text-sm font-medium">Kind</label>
            <select id="kind" name="kind" className={`${FIELD} w-full`} defaultValue={paymentFilters.kind ?? ""}>
              <option value="">All kinds</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label htmlFor="from" className="block text-sm font-medium">From</label>
            <input id="from" name="from" type="date" max={today} className={`${FIELD} w-full`} defaultValue={paymentFilters.from ?? ""} />
          </div>
          <div className="space-y-2">
            <label htmlFor="to" className="block text-sm font-medium">To</label>
            <input id="to" name="to" type="date" max={today} className={`${FIELD} w-full`} defaultValue={paymentFilters.to ?? ""} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <label htmlFor="courseId" className="block text-sm font-medium">Course</label>
            <select id="courseId" name="courseId" className={`${FIELD} w-full`} defaultValue={paymentFilters.courseId ?? ""}>
              <option value="">Any course</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{courseDisplayName(c)}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="cancelled" value="1" defaultChecked={paymentFilters.includeCancelled} className="size-4" />
            Include cancelled
          </label>
          <div className="flex items-end justify-end gap-2">
            <Button type="submit">Search</Button>
            {searched && (
              <Button asChild variant="ghost">
                <Link href="/search?tab=payments">Clear</Link>
              </Button>
            )}
          </div>
        </form>
      )}

      {/* Keyed on the filter signature: a new search remounts the results. */}
      <SearchResults
        key={`${tab}|${JSON.stringify(params)}`}
        tab={tab}
        students={students}
        payments={payments}
        searched={searched}
        filterSummary={filterSummary}
      />
    </div>
  );
}

function Field({
  id, label, defaultValue, placeholder,
}: {
  id: string; label: string; defaultValue?: string; placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      <input
        id={id}
        name={id}
        className={`${FIELD} w-full`}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        autoComplete="off"
      />
    </div>
  );
}
