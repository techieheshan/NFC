import { requireNavAccess } from "@/lib/authz";

import { loadPanel, searchStudents, takePayment } from "./actions";
import { PaymentScreen } from "./payment-screen";

export const metadata = { title: "Payment" };

export default async function PaymentPage() {
  await requireNavAccess("/payment");

  return (
    <PaymentScreen
      loadPanel={loadPanel}
      takePayment={takePayment}
      searchStudents={searchStudents}
    />
  );
}
