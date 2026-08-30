import { requireNavAccess } from "@/lib/authz";

import { listUsers } from "./actions";
import { UsersScreen } from "./users-screen";

export const metadata = { title: "User Roles" };

export default async function UserRolesPage() {
  // ADMIN only, from the nav config. `listUsers` re-checks it independently.
  await requireNavAccess("/user-roles");

  const users = await listUsers();

  return (
    <div className="mx-auto max-w-3xl">
      <UsersScreen users={users} />
    </div>
  );
}
