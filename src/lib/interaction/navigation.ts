export type InteractionCategory = "local" | "navigation" | "data-view" | "mutation" | "destructive" | "external";

export type NavigationTarget = { href: string; routeKey: string };

const ROUTE_PREFIXES: Array<[string, string]> = [
  ["/dashboard", "dashboard"],
  ["/courses/ielts", "course-roadmap"],
  ["/coach", "coach"],
  ["/notifications", "notifications"],
  ["/live-classes", "live-classes"],
  ["/assignments", "assignments"],
  ["/listening", "listening"],
  ["/video-lessons", "video-lessons"],
  ["/reading", "reading"],
  ["/writing", "writing"],
  ["/speaking", "speaking"],
  ["/grammar", "grammar"],
  ["/vocabulary", "vocabulary"],
  ["/progress", "progress"],
  ["/mocks", "mocks"],
  ["/support", "support"],
  ["/management", "management"],
  ["/admin", "management"],
  ["/teacher", "management"],
  ["/owner", "management"],
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
