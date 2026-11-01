import { searchStudents } from "../payment/actions";
import { requirePaymentNewPage } from "./access";
import { identifyStudent } from "./actions";
import { StartScreen } from "./start-screen";

export const metadata = { title: "Payment" };

/**
 * The new Payment start screen: the Payment menu entry opens it. ADMIN + STAFF,
 * through the one constant in ./access.ts. The old /payment address no longer has a
 * menu entry, so it answers not-found.
 */
export default async function PaymentNewPage() {
  await requirePaymentNewPage();
  return <StartScreen identify={identifyStudent} searchStudents={searchStudents} />;
}
