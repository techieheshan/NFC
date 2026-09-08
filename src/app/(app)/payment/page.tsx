import { requireNavAccess } from "@/lib/authz";
import { getToggle } from "@/lib/settings";

import { loadPanel, searchStudents, takePayment } from "./actions";
import { PaymentScreen } from "./payment-screen";

export const metadata = { title: "Payment" };

export default async function PaymentPage() {
  await requireNavAccess("/payment");
  const voiceEnabled = await getToggle("voice_confirmations");

  return (
    <PaymentScreen
      loadPanel={loadPanel}
      takePayment={takePayment}
      searchStudents={searchStudents}
      voiceEnabled={voiceEnabled}
    />
  );
}
