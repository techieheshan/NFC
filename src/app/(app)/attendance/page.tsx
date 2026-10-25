import {
  loadPanel,
  searchStudents as paymentSearch,
  takePayment,
} from "@/app/(app)/payment/actions";
import { requireNavAccess } from "@/lib/authz";
import { getToggle } from "@/lib/settings";

import {
  loadClassAttendance,
  loadWorkingSet,
  markCandidate,
  resolveScan,
  searchAttender,
  syncMarks,
  undoMark,
} from "./actions";
import { AttendanceScreen } from "./attendance-screen";

export const metadata = { title: "Attendance" };

export default async function AttendancePage() {
  await requireNavAccess("/attendance");

  // Read once per page load; the tones are unaffected by it.
  const voiceEnabled = await getToggle("voice_confirmations");

  return (
    <AttendanceScreen
      resolveScan={resolveScan}
      markCandidate={markCandidate}
      undoMark={undoMark}
      searchAttender={searchAttender}
      loadClassAttendance={loadClassAttendance}
      loadWorkingSet={loadWorkingSet}
      syncMarks={syncMarks}
      loadPanel={loadPanel}
      takePayment={takePayment}
      paymentSearch={paymentSearch}
      voiceEnabled={voiceEnabled}
    />
  );
}
