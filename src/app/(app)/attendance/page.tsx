import {
  loadPanel,
  searchStudents as paymentSearch,
  takePayment,
} from "@/app/(app)/payment/actions";
import { requireNavAccess } from "@/lib/authz";

import {
  loadWorkingSet,
  markCandidate,
  resolveScan,
  searchStudents,
  syncMarks,
  undoMark,
} from "./actions";
import { AttendanceScreen } from "./attendance-screen";

export const metadata = { title: "Attendance" };

export default async function AttendancePage() {
  await requireNavAccess("/attendance");

  return (
    <AttendanceScreen
      resolveScan={resolveScan}
      markCandidate={markCandidate}
      undoMark={undoMark}
      searchStudents={searchStudents}
      loadWorkingSet={loadWorkingSet}
      syncMarks={syncMarks}
      loadPanel={loadPanel}
      takePayment={takePayment}
      paymentSearch={paymentSearch}
    />
  );
}
