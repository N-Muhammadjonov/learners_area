/**
 * Learning mode vs Management mode.
 *
 * The product has two jobs in one application: a student reading a passage and
 * an owner reviewing admissions are not doing the same kind of thing, and one
 * navigation list that holds both is how an owner ends up with thirty links in
 * the sidebar while reading.
 *
 * The mode is derived from the route, never from a click. A management page
 * reached from a bookmark, a link in a chat, a browser refresh or a search
 * result must still show the management navigation — mode held in component
 * state would silently show the wrong one after any of those.
 */
export const MANAGEMENT_PREFIXES = ["/management", "/admin", "/owner", "/teacher"] as const;

export function isManagementRoute(pathname: string): boolean {
  return MANAGEMENT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
