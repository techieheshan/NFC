import { searchStudents } from "../payment/actions";
import { requirePaymentNewPage } from "./access";
import { identifyStudent } from "./actions";
import { StartScreen } from "./start-screen";

export const metadata = { title: "Payment" };

/**
 * The new Payment start screen. Not in the menu: it is reached by its address
 * while the old /payment stays the default. ADMIN only for now, through the one
 * constant in ./access.ts that is flipped at the menu switch.
 */
export default async function PaymentNewPage() {
  await requirePaymentNewPage();
  return <StartScreen identify={identifyStudent} searchStudents={searchStudents} />;
}
