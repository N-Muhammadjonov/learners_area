"use client";

import { usePathname } from "next/navigation";

const SECTIONS = {
  "/app/listening/lessons": "lessons",
  "/app/listening/academic": "academic",
  "/app/listening/general": "general",
  "/app/listening/mcq": "mcq",
} as const;

/** Keep exactly one section title ABOVE the Listening tabs.
 * A nested test, exercise or lesson still has its own heading inside the page.
 * The fixed app Topbar continues to show just the parent module "Listening".
 */
export function ListeningSectionHeading({ titles }: {
  titles: Record<(typeof SECTIONS)[keyof typeof SECTIONS], string>;
}) {
  const pathname = usePathname();
  const key = pathname ? SECTIONS[pathname as keyof typeof SECTIONS] : undefined;
  if (!key) return null;
  return (
    <h1 className="font-display text-2xl text-ink-900" data-listening-section-heading={key}>
      {titles[key]}
    </h1>
  );
}
