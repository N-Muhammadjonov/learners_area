"use client";

import { useLayoutEffect } from "react";
import { privateResources } from "@/lib/client/private-resource";

/**
 * Binds the private in-memory read cache to the user the server just
 * authenticated. Rendered by the authenticated layout, which re-validates the
 * session, role and accountStatus from the database on every request; a
 * different user id clears every cached entry before any child reads it.
 * Unmounting (leaving the private area, e.g. logout → /login) clears it too.
 */
export function PrivateResourceScope({ scope }: { scope: string }) {
  // Set synchronously during render as well, so the first child effect already
  // sees the right scope.
  privateResources.setScope(scope);
  useLayoutEffect(() => {
    privateResources.setScope(scope);
    return () => privateResources.setScope(null);
  }, [scope]);
  return null;
}
