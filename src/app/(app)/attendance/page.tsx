import { requireNavAccess } from "@/lib/authz";

import {
  markCandidate,
  resolveScan,
  searchStudents,
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
    />
  );
}
