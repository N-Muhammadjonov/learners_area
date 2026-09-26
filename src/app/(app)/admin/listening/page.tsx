import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdministrator } from "@/lib/auth/current-user";
import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import { listeningTests } from "@/db/schema";
import { getDictionary, getLocale } from "@/lib/i18n";
import { Card } from "@/components/ui/Card";
import { NewTestForm } from "@/components/admin/NewTestForm";
import { PublicationControl } from "@/components/admin/PublicationControl";

export default async function AdminListeningPage() {
  // Authorization is a database read, not a menu decision: this page used to
  // rely on the edge guard's cookie, which goes stale the moment a role changes.
  const administrator = await requireAdministrator();
  if (!administrator) redirect("/dashboard");
  const dict = getDictionary(await getLocale());
  const tests = await db.query.listeningTests.findMany({ orderBy: desc(listeningTests.createdAt) });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl text-ink-900">Listening tests</h1>
        <NewTestForm dict={dict} />
      </div>
      <div className="flex flex-col gap-2">
        {tests.map((t) => (
          <Link key={t.id} href={`/admin/listening/${t.id}`}>
            <Card className="flex items-center justify-between hover:border-signal-400">
              <span className="text-sm font-medium text-ink-900">{t.title}</span>
              <div className="flex flex-col items-end gap-1">
                <span className="text-xs text-ink-300">{t.difficultyLevel}</span>
                <PublicationControl
                  type="listening"
                  id={t.id}
                  state={t.publicationState}
                  publishAt={t.publishAt ? t.publishAt.toISOString() : null}
                  dict={dict}
                />
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
