import { db } from "@/db/client";
import { desc } from "drizzle-orm";
import { users } from "@/db/schema";
import { getDictionary, getLocale } from "@/lib/i18n";
import { Card } from "@/components/ui/Card";
import { RoleSelect } from "@/components/admin/RoleSelect";

export default async function AdminUsersPage() {
  const dict = getDictionary(getLocale());
  const allUsers = await db.query.users.findMany({ orderBy: desc(users.createdAt), limit: 100 });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="font-display text-2xl text-ink-900">{dict.admin.usersTitle}</h1>
      <div className="flex flex-col gap-2">
        {allUsers.map((u) => (
          <Card key={u.id} className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-ink-900">{u.name}</p>
              <p className="text-xs text-ink-300">{u.email ?? "Telegram"}</p>
            </div>
            <RoleSelect userId={u.id} currentRole={u.role} />
          </Card>
        ))}
      </div>
    </div>
  );
}
