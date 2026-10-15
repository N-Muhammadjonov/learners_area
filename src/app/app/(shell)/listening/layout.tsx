import { ModuleNavigation } from "@/components/navigation/ModuleNavigation";
import { ListeningSectionHeading } from "@/components/listening/ListeningSectionHeading";
import { getDictionary, getLocale } from "@/lib/i18n";

export default async function ListeningLayout({ children }: { children: React.ReactNode }) {
  const dict = getDictionary(await getLocale());
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-5" data-module-layout="listening">
      <ListeningSectionHeading titles={{
        lessons: dict.listening.lessons.title,
        academic: dict.listening.academic.title,
        general: dict.listening.general.title,
        mcq: dict.listening.mcqProgram.title,
      }} />
      <ModuleNavigation module="listening" />
      {children}
    </div>
  );
}
