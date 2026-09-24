/**
 * Theme and Focus Mode preferences.
 *
 * These live in a plain module — not in the client components — because the
 * cookie name and the storage key are read by the *server* as well (the root
 * layout renders `data-theme` before the first byte, and `POST /api/theme`
 * writes the cookie). Importing a constant from a `"use client"` file into a
 * server module gives you a client-reference proxy, not the string, which is
 * exactly the kind of bug that makes a theme silently stop persisting.
 *
 * Both preferences are presentation only: neither is ever an authorization
 * input, and neither is stored anywhere but on the visitor's own device.
 */

export const THEME_COOKIE = "la_theme";
export type Theme = "day" | "night";

export function isTheme(value: unknown): value is Theme {
  return value === "day" || value === "night";
}

/** Resolve a theme from a cookie value, defaulting to Day Mode. */
export function themeFromCookie(raw: string | undefined): Theme {
  return raw === "night" ? "night" : "day";
}

export const FOCUS_STORAGE_KEY = "la_focus";
export type FocusMode = "on" | "off";

export function isFocusMode(value: unknown): value is FocusMode {
  return value === "on" || value === "off";
}
