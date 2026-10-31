import { requireNavAccess } from "@/lib/authz";

import { searchStudents } from "../payment/actions";
import { identifyStudent } from "./actions";
import { StartScreen } from "./start-screen";

export const metadata = { title: "Payment" };

/**
 * The new Payment start screen. Not in the menu: it is reached by its address
 * while the old /payment stays the default. Guarded with the SAME nav entry as
 * the old screen, so the roles that may open it are exactly the roles that may
 * open /payment — one source of truth, no second menu entry.
 */
export default async function PaymentNewPage() {
  await requireNavAccess("/payment");
  return <StartScreen identify={identifyStudent} searchStudents={searchStudents} />;
}
