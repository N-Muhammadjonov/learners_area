import { ModuleNavigation } from "@/components/navigation/ModuleNavigation";
import { ReadingSectionHeading } from "@/components/reading/ReadingSectionHeading";
import { getDictionary, getLocale } from "@/lib/i18n";

export default async function ReadingLayout({ children }: { children: React.ReactNode }) {
  const dict = getDictionary(await getLocale());
  return <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-5" data-module-layout="reading">
    <ReadingSectionHeading titles={{ lessons: dict.readingV4.products.lessons.title, academic: dict.readingV4.products.academic.title, general: dict.generalReading.title, types: dict.readingV4.products["question-types"].title }} />
    <ModuleNavigation module="reading" />
    {children}
  </div>;
}
