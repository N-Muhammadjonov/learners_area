"use client";
import { useCallback, useEffect, useRef } from "react";
import { requestJson } from "./client-request";

/** Superseded/unmounted requests return no UI result; each request has a deadline. */
export function useScopedRequest() {
  const active = useRef<{controller: AbortController; key: string} | null>(null);
  useEffect(() => () => { active.current?.controller.abort(); active.current = null; }, []);
  return useCallback(async <T,>(url: string, options: Parameters<typeof requestJson>[1] = {}) => {
    const key = JSON.stringify([url, options.method ?? "POST", options.body ?? null]);
    // A same-event double press must not send a second possibly committed write.
    // The first request still owns its eventual success/failure and UI release.
    if (!options.form && active.current?.key === key) return null;
    active.current?.controller.abort();
    const controller = new AbortController();
    active.current = {controller, key};
    const result = await requestJson<T>(url, { ...options, signal: controller.signal });
    if (active.current?.controller !== controller || controller.signal.aborted) return null;
    active.current = null;
    return result;
  }, []);
}
