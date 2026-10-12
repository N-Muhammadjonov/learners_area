"use client";

import {
  createContext,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { controlFamily, internalNavigationTarget, routeLocation, type InteractionCategory } from "@/lib/interaction/navigation";
import type { EntryFrames } from "@/lib/interaction/section-entry";

type NavigationIntent = {
  id: string;
  from: string;
  to: string;
  routeKey: string;
  startedAt: number;
  restoreScroll: boolean;
};

type InteractionContextValue = {
  navigation: NavigationIntent | null;
  currentLocation: string;
  entryFrames: EntryFrames;
  slowMessage: string;
  retryLabel: string;
  stalled: boolean;
  beginNavigation: (href: string) => void;
  navigate: (href: string, replace?: boolean) => void;
  beginMeasurement: (category: InteractionCategory, family: string) => string | null;
  finishMeasurement: (id: string | null, outcome?: "success" | "failure") => void;
  retryNavigation: () => void;
};

const InteractionContext = createContext<InteractionContextValue | null>(null);
const NAVIGATION_TIMEOUT_MS = 15_000;
const round = (value: number) => Math.round(value * 10) / 10;

function correlationId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function metric(event: string, fields: Record<string, string | number | boolean>) {
  console.info(`[qa-perf] ${JSON.stringify({ event, ...fields })}`);
}

function firstFrame(id: string, category: InteractionCategory, family: string, startedAt: number) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    metric("firstResponsePaintOpportunity", {
      id,
      category,
      controlFamily: family,
      responseLatencyMs: round(performance.now() - startedAt),
      responseSignal: "double-animation-frame-paint-opportunity",
    });
  }));
}

export function useInstantInteraction() {
  const value = useContext(InteractionContext);
  if (!value) throw new Error("useInstantInteraction must be used inside InstantInteractionProvider");
  return value;
}

export function useOptionalInstantInteraction() {
  return useContext(InteractionContext);
}

export function InstantInteractionProvider({
  children,
  diagnostics = false,
  entryFrames = {},
  slowMessage = "",
  retryLabel = "",
}: {
  children: ReactNode;
  diagnostics?: boolean;
  entryFrames?: EntryFrames;
  slowMessage?: string;
  retryLabel?: string;
}) {
  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? "";
  const currentLocation = routeLocation(pathname, search);
  const router = useRouter();
  const [navigation, setNavigation] = useState<NavigationIntent | null>(null);
  const [stalledId, setStalledId] = useState<string | null>(null);
  const sequence = useRef(0);
  const measurements = useRef(new Map<string, number>());
  const scrollPositions = useRef(new Map<string, number>());

  const saveMainScroll = useCallback((location: string) => {
    const main = document.getElementById("main-content");
    if (!main) return;
    scrollPositions.current.delete(location);
    scrollPositions.current.set(location, main.scrollTop);
    if (scrollPositions.current.size > 100) {
      const oldest = scrollPositions.current.keys().next().value;
      if (oldest) scrollPositions.current.delete(oldest);
    }
  }, []);

  const recordImmediateInteraction = useCallback((category: InteractionCategory, family: string) => {
    if (!diagnostics) return;
    const id = `${++sequence.current}-${correlationId()}`;
    const startedAt = performance.now();
    metric("interactionStart", { id, category, controlFamily: family });
    firstFrame(id, category, family, startedAt);
  }, [diagnostics]);

  const beginMeasurement = useCallback((category: InteractionCategory, family: string) => {
    if (!diagnostics) return null;
    const id = `${++sequence.current}-${correlationId()}`;
    const startedAt = performance.now();
    measurements.current.set(id, startedAt);
    metric("interactionStart", { id, category, controlFamily: family });
    firstFrame(id, category, family, startedAt);
    return id;
  }, [diagnostics]);

  const finishMeasurement = useCallback((id: string | null, outcome: "success" | "failure" = "success") => {
    if (!diagnostics || !id) return;
    const startedAt = measurements.current.get(id);
    if (startedAt === undefined) return;
    measurements.current.delete(id);
    metric("asyncCompletion", {
      id,
      outcome,
      completionLatencyMs: round(performance.now() - startedAt),
      completionSource: "awaited-action",
    });
  }, [diagnostics]);

  const beginNavigation = useCallback((href: string) => {
    if (typeof window === "undefined") return;
    const target = internalNavigationTarget(href, window.location.origin, currentLocation);
    if (!target) return;
    if (navigation?.to === target.href && navigation.from === currentLocation) return;

    saveMainScroll(currentLocation);
    const startedAt = performance.now();
    const id = `${++sequence.current}-${correlationId()}`;
    const intent: NavigationIntent = { id, from: currentLocation, to: target.href, routeKey: target.routeKey, startedAt, restoreScroll: false };
    setNavigation(intent);
    setStalledId(null);
    if (diagnostics) {
      metric("interactionStart", { id, category: "navigation", controlFamily: "link", routeKey: target.routeKey });
      firstFrame(id, "navigation", "link", startedAt);
    }
  }, [currentLocation, diagnostics, navigation, saveMainScroll]);

  const navigate = useCallback((href: string, replace = false) => {
    beginNavigation(href);
    if (replace) router.replace(href);
    else router.push(href);
  }, [beginNavigation, router]);

  useEffect(() => {
    if (!navigation || currentLocation === navigation.from) return;
    if (diagnostics) {
      const elapsed = round(performance.now() - navigation.startedAt);
      metric("destinationRouteCommit", {
        id: navigation.id,
        routeKey: navigation.routeKey,
        routeCommitLatencyMs: elapsed,
        outcome: currentLocation === navigation.to ? "success" : "redirected",
      });
    }
    const main = document.getElementById("main-content");
    if (main && navigation.restoreScroll) main.scrollTop = scrollPositions.current.get(currentLocation) ?? 0;
    else if (main) main.scrollTop = 0;
    main?.focus({ preventScroll: true });
    setNavigation(null);
    setStalledId(null);
  }, [currentLocation, diagnostics, navigation]);

  useEffect(() => {
    function onPopState() {
      const target = internalNavigationTarget(
        `${window.location.pathname}${window.location.search}`,
        window.location.origin,
        currentLocation,
      );
      if (!target) return;
      saveMainScroll(currentLocation);
      const startedAt = performance.now();
      const id = `${++sequence.current}-${correlationId()}`;
      setNavigation({ id, from: currentLocation, to: target.href, routeKey: target.routeKey, startedAt, restoreScroll: true });
      setStalledId(null);
      if (diagnostics) {
        metric("interactionStart", { id, category: "navigation", controlFamily: "history", routeKey: target.routeKey });
        firstFrame(id, "navigation", "history", startedAt);
      }
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [currentLocation, diagnostics, saveMainScroll]);

  useEffect(() => {
    if (!navigation) return;
    const id = navigation.id;
    const timer = window.setTimeout(() => setStalledId(id), NAVIGATION_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [navigation]);

  const retryNavigation = useCallback(() => {
    if (!navigation) return;
    const href = navigation.to;
    const startedAt = performance.now();
    const id = `${++sequence.current}-${correlationId()}`;
    setNavigation({ ...navigation, id, from: currentLocation, startedAt });
    setStalledId(null);
    router.push(href);
  }, [currentLocation, navigation, router]);

  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const control = target.closest<HTMLElement>("a[href],button,input,select,textarea,summary,[role='button'],[role='tab'],[role='menuitem']");
    if (!control || control.getAttribute("aria-disabled") === "true") return;
    const anchor = control instanceof HTMLAnchorElement ? control : control.closest<HTMLAnchorElement>("a[href]");
    const type = control.getAttribute("data-interaction-type") as InteractionCategory | null;
    const family = controlFamily(control.tagName, control.getAttribute("role"));

    if (anchor) {
      let target: URL | null = null;
      try { target = new URL(anchor.href, window.location.origin); } catch { /* malformed href: preserve native behavior */ }
      if (target && target.origin !== window.location.origin) {
        recordImmediateInteraction("external", family);
        return;
      }
      // A new click back to the current URL cancels the optimistic indicator.
      // Next still owns the actual request/history; do not call replaceState.
      if (navigation && target?.origin === window.location.origin &&
        `${target.pathname}${target.search}` === currentLocation && event.button === 0 &&
        !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey &&
        anchor.target !== "_blank" && !anchor.hasAttribute("download")) {
        setNavigation(null);
        setStalledId(null);
        return;
      }
      const resolved = internalNavigationTarget(anchor.href, window.location.origin, currentLocation);
      if (resolved && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey &&
        anchor.target !== "_blank" && !anchor.hasAttribute("download") && !anchor.hasAttribute("data-no-instant-navigation")) {
        beginNavigation(anchor.href);
        return;
      }
      if (resolved) {
        recordImmediateInteraction("navigation", family);
        return;
      }
    }

    const form = control.closest("form");
    const submitsForm = form && (
      (control instanceof HTMLButtonElement && (control.type === "submit" || !control.hasAttribute("type"))) ||
      (control instanceof HTMLInputElement && ["submit", "image"].includes(control.type))
    );
    if (submitsForm) return;
    const category = type ?? "local";
    recordImmediateInteraction(category, family);
  }, [beginNavigation, currentLocation, navigation, recordImmediateInteraction]);

  const onChangeCapture = useCallback((event: ChangeEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
    const type = target.getAttribute("data-interaction-type") as InteractionCategory | null;
    recordImmediateInteraction(type ?? "local", controlFamily(target.tagName, target.getAttribute("role")));
  }, [recordImmediateInteraction]);

  const onSubmitCapture = useCallback((event: FormEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLFormElement)) return;
    const declared = target.getAttribute("data-interaction-type") as InteractionCategory | null;
    recordImmediateInteraction(declared ?? "mutation", "form");
  }, [recordImmediateInteraction]);

  const value = useMemo<InteractionContextValue>(() => ({
    navigation,
    currentLocation,
    entryFrames,
    slowMessage,
    retryLabel,
    stalled: Boolean(navigation && stalledId === navigation.id),
    beginNavigation,
    navigate,
    beginMeasurement,
    finishMeasurement,
    retryNavigation,
  }), [beginMeasurement, beginNavigation, currentLocation, entryFrames, finishMeasurement, navigate, navigation, retryLabel, retryNavigation, slowMessage, stalledId]);

  return (
    <InteractionContext.Provider value={value}>
      <div className="contents" onChangeCapture={onChangeCapture} onClickCapture={onClickCapture} onSubmitCapture={onSubmitCapture}>
        {children}
      </div>
    </InteractionContext.Provider>
  );
}
