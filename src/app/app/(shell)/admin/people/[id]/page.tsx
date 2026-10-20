import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireAdministrator } from "@/lib/auth/current-user";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { isUuid } from "@/lib/validation/ids";
import { getDictionary, getLocale } from "@/lib/i18n";
import { BackLink } from "@/components/ui/BackLink";
import { StudentResults } from "@/components/admin/StudentResults";
export default async function StudentResultsPage({ params,searchParams }: { params: Promise<{ id: string }>; searchParams:Promise<{module?:string;page?:string}> }) {
  const actor = await requireAdministrator();
  if (!actor) redirect("/app");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const student = await db.query.users.findFirst({ where: eq(users.id, id), columns: { id: true, name: true, email: true } });
  if (!student) notFound();
  const dict = getDictionary(await getLocale());
  return <div className="mx-auto max-w-6xl space-y-6"><BackLink fallbackHref="/app/admin/people" label={dict.nav.people} /><div><h1 className="font-display text-3xl">{student.name}</h1><p className="text-ink-500">{student.email ?? "Telegram"}</p></div><StudentResults studentId={id} dict={dict} filter={await searchParams} baseHref={`/app/admin/people/${id}`} /></div>;
}
