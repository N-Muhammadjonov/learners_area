"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import { headerModule, headerSection, moduleSectionLinks } from "@/lib/nav/module-sections";
import { ModuleSectionNav } from "@/components/navigation/ModuleSectionNav";
import { WritingNav } from "@/components/writing/workspace/WritingNav";
import { parseWritingTab } from "@/lib/writing/tabs";

export function ModuleHeaderTitle({ dict }: { dict: Dictionary }) {
  const path = usePathname();
  const params = useSearchParams();
  const section = headerSection(path, params.get("tab"), dict);
  if (!section) return null;
  const props = {className: "text-sm font-medium leading-snug", "data-module-section-heading": `${section.module}:${section.key}`,
    "data-vocabulary-section-heading": section.module === "vocabulary" ? section.key : undefined};
  return section.index ? <h1 {...props}>{section.title}</h1> : <span {...props}>{section.title}</span>;
}

export function ModuleHeaderNavigation({ dict }: { dict: Dictionary }) {
  const path = usePathname();
  const params = useSearchParams();
  const activeModule = headerModule(path);
  if (!activeModule) return null;
  if (activeModule === "writing") return path === "/app/writing" ? <div className="min-w-0 px-3 md:px-5" data-module-header-navigation="writing">
    <WritingNav active={parseWritingTab(params.get("tab") ?? undefined)} labels={dict.writingWorkspace.tabs} label={dict.writingWorkspace.tabsLabel} />
  </div> : null;
  if (activeModule === "video-lessons") return null;
  const links = moduleSectionLinks(dict, activeModule);
  return links.length ? <div className="min-w-0 px-3 md:px-5" data-module-header-navigation={activeModule} data-vocabulary-header-navigation={activeModule === "vocabulary" ? true : undefined}>
    <ModuleSectionNav module={activeModule} label={dict.nav[activeModule]} links={links} />
  </div> : null;
}
