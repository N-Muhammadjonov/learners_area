import { redirect } from "next/navigation";
import { requireAdministrator } from "@/lib/auth/current-user";
import { grantableRoles } from "@/lib/auth/roles";
import { listPeople } from "@/lib/data/people";
import { getDictionary, getLocale } from "@/lib/i18n";
import { PeopleTable } from "@/components/admin/PeopleTable";

export const dynamic = "force-dynamic";

/**
 * People and roles.
 *
 * Every control on this page is a request, not a permission: the actor's role is
 * loaded from the database (not the cookie), and the API re-checks who may grant
 * what and to whom.
 */
export default async function AdminPeoplePage() {
  const actor = await requireAdministrator();
  if (!actor) redirect("/dashboard");

  const dict = getDictionary(await getLocale());
  const people = await listPeople();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl text-ink-900">{dict.people.title}</h1>
        <p className="text-sm text-ink-500">{dict.people.subtitle}</p>
      </div>
      <PeopleTable
        dict={dict}
        locale={await getLocale()}
        people={people}
        actorId={actor.id}
        actorRole={actor.role}
        grantableRoles={grantableRoles(actor.role)}
      />
    </div>
  );
}
