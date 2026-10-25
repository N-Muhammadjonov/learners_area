import { ModuleNavigation } from "@/components/navigation/ModuleNavigation";

export default function ListeningLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-5" data-module-layout="listening">
    <ModuleNavigation module="listening" />
    {children}
  </div>;
}
