import { APP_HOME } from "@/lib/nav/private-modules.mjs";

export type InteractionCategory = "local" | "navigation" | "data-view" | "mutation" | "destructive" | "external";

export type NavigationTarget = { href: string; routeKey: string };

const ROUTE_PREFIXES: Array<[string, string]> = [
  ["/app/courses/ielts", "course-roadmap"],
  ["/app/coach", "coach"],
  ["/app/notifications", "notifications"],
  ["/app/live-classes", "live-classes"],
  ["/app/assignments", "assignments"],
  ["/app/listening", "listening"],
  ["/app/video-lessons", "video-lessons"],
  ["/app/reading", "reading"],
  ["/app/writing", "writing"],
  ["/app/speaking", "speaking"],
  ["/app/grammar", "grammar"],
  ["/app/vocabulary", "vocabulary"],
  ["/app/progress", "progress"],
  ["/app/mocks", "mocks"],
  ["/app/support", "support"],
  ["/app/management", "management"],
  ["/app/admin", "management"],
  ["/app/teacher", "management"],
  ["/app/owner", "management"],
];

/** Remove URL fragments and preserve the actual route/query for router semantics. */
export function routeLocation(pathname: string, search = ""): string {
  const normalizedSearch = search && search !== "?" ? (search.startsWith("?") ? search : `?${search}`) : "";
  return `${pathname || "/"}${normalizedSearch}`;
}

/** Resolve only same-origin navigations; native external/new-tab semantics stay untouched. */
export function internalNavigationTarget(
  rawHref: string,
  currentOrigin: string,
  currentLocation: string,
): NavigationTarget | null {
  let target: URL;
  let current: URL;
  try {
    target = new URL(rawHref, currentOrigin);
    current = new URL(currentLocation, currentOrigin);
  } catch {
    return null;
  }
  if (target.origin !== currentOrigin || !["http:", "https:"].includes(target.protocol)) return null;
  const href = routeLocation(target.pathname, target.search);
  if (href === routeLocation(current.pathname, current.search)) return null;
  return { href, routeKey: workspaceKey(target.pathname) };
}

/** Route metrics contain only a fixed workspace key, never path ids or search text. */
export function workspaceKey(pathname: string): string {
  if (pathname === APP_HOME) return "dashboard";
  const match = ROUTE_PREFIXES.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return match?.[1] ?? "other";
}

export function controlFamily(elementName: string, role?: string | null): string {
  const normalizedRole = role?.trim().toLowerCase();
  if (normalizedRole === "tab") return "tab";
  if (normalizedRole === "menuitem") return "menu-item";
  if (normalizedRole === "button") return "button";
  switch (elementName.toLowerCase()) {
    case "a": return "link";
    case "button": return "button";
    case "summary": return "dropdown-trigger";
    case "select": return "select";
    case "input": return "input";
    case "textarea": return "textarea";
    case "form": return "form";
    default: return "control";
  }
}
