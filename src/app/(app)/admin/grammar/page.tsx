import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdministrator } from "@/lib/auth/current-user";
import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { grammarTopics } from "@/db/schema";
import { getDictionary, getLocale } from "@/lib/i18n";
import { Card } from "@/components/ui/Card";
import { GrammarImport } from "@/components/admin/GrammarImport";
import { NewTopicForm } from "@/components/admin/NewTopicForm";

export default async function AdminGrammarPage() {
  // Authorization is a database read, not a menu decision: this page used to
  // rely on the edge guard's cookie, which goes stale the moment a role changes.
  const administrator = await requireAdministrator();
  if (!administrator) redirect("/dashboard");
  const dict = getDictionary(await getLocale());
  const topics = await db.query.grammarTopics.findMany({ orderBy: asc(grammarTopics.order) });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl text-ink-900">{dict.admin.grammarTitle}</h1>
        <NewTopicForm dict={dict} />
      </div>
      <GrammarImport dict={dict} />
      <div className="flex flex-col gap-2">
        {topics.map((t) => (
          <Link key={t.id} href={`/admin/grammar/${t.id}`}>
            <Card className="flex items-center justify-between hover:border-signal-400">
              <span className="text-sm font-medium text-ink-900">{t.title}</span>
              <span className="text-xs text-ink-300">{t.skillArea}</span>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
