import { redirect } from "next/navigation";
import { requireAdministrator } from "@/lib/auth/current-user";
import { isAccountStatus } from "@/lib/auth/account-status";
import { grantableRoles, isRole } from "@/lib/auth/roles";
import { listPeople } from "@/lib/data/people";
import { getDictionary, getLocale } from "@/lib/i18n";
import { PeopleTable } from "@/components/admin/PeopleTable";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function pageNumber(value: string | string[] | undefined): number {
  const parsed = Number(first(value));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * People and roles.
 *
 * Every control on this page is a request, not a permission: the actor's role is
 * loaded from the database (not the cookie), and the API re-checks who may grant
 * what and to whom. Search and filters are URL state, but the data predicate and
 * its bounded page are applied by PostgreSQL before rows reach the browser.
 */
export default async function AdminPeoplePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const actor = await requireAdministrator();
  if (!actor) redirect("/app/dashboard");

  const [params, locale] = await Promise.all([searchParams, getLocale()]);
  const rawRole = first(params.role);
  const rawStatus = first(params.status);
  const directory = await listPeople({
    q: first(params.q),
    role: isRole(rawRole) ? rawRole : undefined,
    status: isAccountStatus(rawStatus) ? rawStatus : undefined,
    page: pageNumber(params.page),
  });
  const dict = getDictionary(locale);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl text-ink-900">{dict.people.title}</h1>
        <p className="text-sm text-ink-500">{dict.people.subtitle}</p>
      </div>
      <PeopleTable
        dict={dict}
        locale={locale}
        people={directory.people}
        filters={directory.filters}
        page={directory.page}
        pageSize={directory.pageSize}
        total={directory.total}
        totalPages={directory.totalPages}
        actorId={actor.id}
        actorRole={actor.role}
        grantableRoles={grantableRoles(actor.role)}
      />
    </div>
  );
}
