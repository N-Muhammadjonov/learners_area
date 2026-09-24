import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdministrator } from "@/lib/auth/current-user";
import { db } from "@/db/client";
import { desc } from "drizzle-orm";
import { readingPassages } from "@/db/schema";
import { getDictionary, getLocale } from "@/lib/i18n";
import { Card } from "@/components/ui/Card";
import { NewPassageForm } from "@/components/admin/NewPassageForm";

export default async function AdminReadingPage() {
  // Authorization is a database read, not a menu decision: this page used to
  // rely on the edge guard's cookie, which goes stale the moment a role changes.
  const administrator = await requireAdministrator();
  if (!administrator) redirect("/dashboard");
  const dict = getDictionary(getLocale());
  const passages = await db.query.readingPassages.findMany({ orderBy: desc(readingPassages.createdAt) });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl text-ink-900">{dict.admin.readingTitle}</h1>
        <NewPassageForm dict={dict} />
      </div>
      <div className="flex flex-col gap-2">
        {passages.map((p) => (
          <Link key={p.id} href={`/admin/reading/${p.id}`}>
            <Card className="flex items-center justify-between hover:border-signal-400">
              <span className="text-sm font-medium text-ink-900">{p.title}</span>
              <span className="text-xs text-ink-300">{p.difficultyLevel} · {p.suggestedMinutes} min</span>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
