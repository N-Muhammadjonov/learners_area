import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listAllForManagement } from "@/lib/data/speaking";
import { canManageContent } from "@/lib/auth/ownership";
import { NewMaterialForm } from "@/components/speaking/NewMaterialForm";
import { SpeakingPromptComposer } from "@/components/speaking/SpeakingPromptComposer";
import { db } from "@/db/client";
import { ManagedMaterialCard } from "@/components/speaking/ManagedMaterialCard";

export default async function TeacherSpeakingPage() {
  const user = await requireStaff();
  if (!user) redirect("/dashboard");
  const dict = getDictionary(await getLocale());
  const rows = await listAllForManagement();
  const prompts = user.role === "owner" || user.role === "admin" ? await db.query.speakingPrompts.findMany() : [];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl text-ink-900">{dict.speaking.manageTitle}</h1>
        {user.role === "teacher" && <NewMaterialForm dict={dict} />}

      </div>
      {(user.role === "owner" || user.role === "admin") && <SpeakingPromptComposer dict={dict} prompts={prompts} />}
      <div className="flex flex-col gap-3">
        {rows.map(({ material, authorName, blocks }) => (
          <ManagedMaterialCard
            key={material.id}
            dict={dict}
            material={material}
            blocks={blocks}
            authorName={authorName}
            canManage={canManageContent(user, material.createdByUserId)}
          />
        ))}
      </div>
    </div>
  );
}
