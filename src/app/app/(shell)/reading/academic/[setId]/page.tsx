import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { isUuid } from "@/lib/validation/ids";
import { generalSetDetail } from "@/lib/data/general-reading";
import { BackLink } from "@/components/ui/BackLink";
import { StartPassageButton } from "@/components/reading/StartPassageButton";

export default async function AcademicSetPage({ params }: { params: Promise<{ setId: string }> }) {
  const { setId } = await params;
  if (!isUuid(setId)) notFound();
  const user = await requireActiveUser();
  if (!user) return null;
  const dict = getDictionary(await getLocale());
  const detail = await generalSetDetail(setId, user.role);
  if (!detail || detail.passages.length !== 3) notFound();
  return <div className="mx-auto flex max-w-[960px] flex-col gap-6" data-academic-reading-start>
    <BackLink fallbackHref="/app/reading" label={dict.common.back} />
    <h1 className="page-title">{detail.set.title}</h1>
    <p className="body-text">{dict.readingHub.academicExamHint}</p>
    <ol className="grid gap-3">{detail.passages.map(section => <li key={section.passageNo} className="card p-4">
      <span className="meta-text">{dict.generalReading.passageN.replace("{n}", String(section.passageNo))}</span>
      <h2 className="card-title">{section.passage.title}</h2>
    </li>)}</ol>
    <StartPassageButton setId={setId} label={dict.generalReading.full} variant="primary" />
  </div>;
}
