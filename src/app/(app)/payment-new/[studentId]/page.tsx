import { notFound } from "next/navigation";

import { buildPaymentView } from "@/lib/payment-view";
import { getToggle } from "@/lib/settings";

import { loadPanel, takePayment } from "../../payment/actions";
import { requirePaymentNewPage } from "../access";
import { loadMonthDetail } from "../actions";
import { StudentScreen } from "../student-screen";

export const metadata = { title: "Payment" };

/**
 * One student's fees. Prices, tiers, combo fees, admission and smart card come
 * from the existing `loadPanel`, untouched; `buildPaymentView` adds the read-only
 * extras (oldest unpaid month, paid day, attended days). Charging is the existing
 * `takePayment`, with the input it has always taken.
 */
export default async function PaymentNewStudentPage({ params }: PageProps<"/payment-new/[studentId]">) {
  await requirePaymentNewPage();

  const { studentId } = await params;
  const id = Number(studentId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const result = await loadPanel({ studentId: id });
  if (result.status === "unknown") notFound();

  const [view, voiceEnabled] = await Promise.all([
    buildPaymentView(result.panel),
    getToggle("voice_confirmations"),
  ]);

  return <StudentScreen view={view} takePayment={takePayment} loadMonthDetail={loadMonthDetail} voiceEnabled={voiceEnabled} />;
}
