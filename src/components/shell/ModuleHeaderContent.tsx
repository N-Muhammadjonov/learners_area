"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Data-dependent library headings reuse their existing server-loaded content. */
export function ModuleHeaderContent({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setSlot(document.getElementById("module-header-extra")); }, []);
  return slot ? createPortal(children, slot) : null;
}
