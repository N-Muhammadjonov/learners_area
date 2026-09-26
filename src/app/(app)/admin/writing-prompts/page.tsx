import { getDictionary, getLocale } from "@/lib/i18n";
import { redirect } from "next/navigation";
import { requireAdministrator } from "@/lib/auth/current-user";
import { listAllPrompts } from "@/lib/data/writing";
import { Card } from "@/components/ui/Card";
import { NewPromptForm } from "@/components/admin/NewPromptForm";
import { PublicationControl } from "@/components/admin/PublicationControl";

export default async function AdminWritingPromptsPage() {
  // Authorization is a database read, not a menu decision: this page used to
  // rely on the edge guard's cookie, which goes stale the moment a role changes.
  const administrator = await requireAdministrator();
  if (!administrator) redirect("/dashboard");
  const dict = getDictionary(await getLocale());
  // Staff see drafts and the archive as well; the student page uses the live list.
  const prompts = await listAllPrompts();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl text-ink-900">{dict.admin.promptsTitle}</h1>
        <NewPromptForm dict={dict} />
      </div>
      <div className="flex flex-col gap-2">
        {prompts.map((p) => (
          <Card key={p.id}>
            <div className="flex items-center justify-between">
              <span className="badge bg-signal-100 text-signal-700">
                {p.taskType === "task1" ? dict.writing.task1 : dict.writing.task2}
              </span>
              <span className="text-xs text-ink-300">{p.category}</span>
              <PublicationControl
                type="writing"
                id={p.id}
                state={p.publicationState}
                publishAt={p.publishAt ? p.publishAt.toISOString() : null}
                dict={dict}
              />
            </div>
            <p className="mt-2 text-sm text-ink-700">{p.prompt}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
