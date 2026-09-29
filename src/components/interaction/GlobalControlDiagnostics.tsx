"use client";

import { useEffect } from "react";
import { controlFamily, workspaceKey, type InteractionCategory } from "@/lib/interaction/navigation";

const round = (value: number) => Math.round(value * 10) / 10;

/** Preview-only, privacy-safe response-frame instrumentation outside the private shell. */
export function GlobalControlDiagnostics() {
  useEffect(() => {
    let sequence = 0;
    const report = (event: string, fields: Record<string, string | number>) => {
      console.info(`[qa-perf] ${JSON.stringify({ event, ...fields })}`);
    };
    const start = (category: InteractionCategory, element: Element) => {
      const id = `public-${++sequence}`;
      const startedAt = performance.now();
      report("interactionStart", {
        id,
        category,
        controlFamily: controlFamily(element.tagName, element.getAttribute("role")),
        routeKey: workspaceKey(location.pathname),
      });
      requestAnimationFrame(() => report("firstVisibleResponse", {
        id,
        category,
        controlFamily: controlFamily(element.tagName, element.getAttribute("role")),
        responseLatencyMs: round(performance.now() - startedAt),
        responseSignal: "next-animation-frame",
      }));
    };
    const click = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || event.target.closest("[data-shell]")) return;
      const control = event.target.closest<HTMLElement>("a[href],button,input,[role='button'],[role='tab']");
      if (!control || control.getAttribute("aria-disabled") === "true") return;
      const link = control instanceof HTMLAnchorElement ? control : control.closest<HTMLAnchorElement>("a[href]");
      if (link) {
        const category: InteractionCategory = link.origin === location.origin ? "navigation" : "external";
        start(category, control);
        return;
      }
      const form = control.closest("form");
      const submit = form && ((control instanceof HTMLButtonElement && (control.type === "submit" || !control.hasAttribute("type"))) ||
        (control instanceof HTMLInputElement && ["submit", "image"].includes(control.type)));
      if (submit) return;
      const category = control.getAttribute("data-interaction-type") as InteractionCategory | null;
      start(category ?? "local", control);
    };
    const change = (event: Event) => {
      if (!(event.target instanceof Element) || event.target.closest("[data-shell]")) return;
      if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement)) return;
      const category = event.target.getAttribute("data-interaction-type") as InteractionCategory | null;
      start(category ?? "local", event.target);
    };
    const submit = (event: Event) => {
      if (!(event.target instanceof HTMLFormElement) || event.target.closest("[data-shell]")) return;
      const category = event.target.getAttribute("data-interaction-type") as InteractionCategory | null;
      start(category ?? "mutation", event.target);
    };
    document.addEventListener("click", click, true);
    document.addEventListener("change", change, true);
    document.addEventListener("submit", submit, true);
    return () => {
      document.removeEventListener("click", click, true);
      document.removeEventListener("change", change, true);
      document.removeEventListener("submit", submit, true);
    };
  }, []);
  return null;
}
