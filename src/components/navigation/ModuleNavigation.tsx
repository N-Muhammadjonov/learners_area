import { Suspense } from "react";
import { getDictionary, getLocale } from "@/lib/i18n";
import { moduleSectionLinks } from "@/lib/nav/module-sections";
import { ModuleSectionNav } from "./ModuleSectionNav";

type Module = "listening" | "reading" | "grammar" | "vocabulary";

export async function ModuleNavigation({ module }: { module: Module }) {
  const dict = getDictionary(await getLocale());
  return <Suspense fallback={<div className="h-12 border-b border-ink-100" aria-hidden="true" />}>
    <ModuleSectionNav module={module} label={dict.nav[module]} links={moduleSectionLinks(dict, module)} />
  </Suspense>;
}
