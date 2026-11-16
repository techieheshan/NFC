import { requireNavAccess } from "@/lib/authz";

import { listUsers } from "./actions";
import { listStaffCards } from "./staff-card-actions";
import { StaffCardsScreen } from "./staff-cards-screen";
import { UsersScreen } from "./users-screen";

export const metadata = { title: "User Roles" };

export default async function UserRolesPage() {
  // ADMIN only, from the nav config. `listUsers` and `listStaffCards` re-check it independently.
  await requireNavAccess("/user-roles");

  const [users, cards] = await Promise.all([listUsers(), listStaffCards()]);

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <UsersScreen users={users} />
      <StaffCardsScreen view={cards} />
    </div>
  );
}
