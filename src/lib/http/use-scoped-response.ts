"use client";
import { useCallback } from "react";
import { useScopedRequest } from "./use-scoped-request";

/** Compatibility adapter for existing JSON API controls. It preserves server
 * validation bodies while sharing requestJson's header/body deadline and the
 * component cancellation scope. Null means obsolete work: callers stop there.
 * A transport or malformed-body failure is an unsuccessful JSON response so
 * existing localized error branches run and release their controls. */
export function useScopedResponse(timeoutMs = 25_000) {
  const request = useScopedRequest();
  return useCallback(async (url: string, init: RequestInit = {}): Promise<Response | null> => {
    const method = (init.method ?? "GET") as "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    const result = await request<unknown>(url, {
      method, timeoutMs,
      ...(typeof init.body === "string" ? {body: JSON.parse(init.body)} : {}),
      ...(init.body instanceof FormData ? {form: init.body} : {}),
    });
    if (!result) return null;
    const status = result.status || 503;
    const data = result.ok ? result.data : result.data ?? {error: result.error ?? "network_error"};
    // Non-JSON 2xx is a failed protocol response, not fake success.
    const invalidData = result.ok && status !== 204 && (data === null || typeof data !== "object");
    const actualStatus = invalidData || (!result.ok && (result.kind === "parse" || result.status < 400)) ? 503 : status;
    return new Response(actualStatus === 204 ? null : JSON.stringify(data), {
      status: actualStatus, headers: {"Content-Type": "application/json"},
    });
  }, [request, timeoutMs]);
}
