"use client";

import { usePathname } from "next/navigation";

const sections = {
  "/app/reading/lessons": "lessons",
  "/app/reading/academic": "academic",
  "/app/reading/general": "general",
  "/app/reading/question-types": "types",
} as const;

export function ReadingSectionHeading({ titles }: { titles: Record<(typeof sections)[keyof typeof sections], string> }) {
  const pathname = usePathname();
  const section = pathname ? sections[pathname as keyof typeof sections] : undefined;
  return section ? <h1 className="font-display text-2xl text-ink-900" data-reading-section-heading={section}>{titles[section]}</h1> : null;
}
