import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { writingPrompts } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { isUuid } from "@/lib/validation/ids";
import { liveWhere } from "@/lib/services/cms/publication";
import { resourceBlocksForPrompts } from "@/lib/data/writing";
import { ResourceBlocks } from "@/components/resources/ResourceBlocks";
import { BackLink } from "@/components/ui/BackLink";
import { StartPromptButton } from "@/components/writing/StartPromptButton";

/** Search opens this exact published question without starting or changing an exam. */
export default async function WritingPromptPage({params}:{params:Promise<{id:string}>}) {
  const user=await requireActiveUser();if(!user)return null;
  const {id}=await params;if(!isUuid(id))notFound();
  const [prompt]=await db.select().from(writingPrompts).where(and(eq(writingPrompts.id,id),liveWhere(writingPrompts))).limit(1);
  if(!prompt)notFound();
  const dict=getDictionary(await getLocale());
  const materials=(await resourceBlocksForPrompts([id])).get(id)??[];
  return <div className="mx-auto flex max-w-3xl flex-col gap-4" data-writing-search-question={id}>
    <BackLink fallbackHref="/app/writing?tab=exam" label={dict.common.back}/>
    <article className="card flex flex-col gap-4 p-6">
      <p>{prompt.taskType==="task1"?dict.writing.task1:dict.writing.task2} · {prompt.category}</p>
      <h1 className="font-display text-xl text-ink-900">{prompt.prompt}</h1>
      <ResourceBlocks dict={dict} blocks={materials}/>
      <p>{dict.writing.target}: {prompt.targetWordCount} {dict.common.words}</p>
      <StartPromptButton promptId={id} label={dict.writing.practiceTitle} errorLabel={dict.common.error}/>
    </article>
  </div>;
}
