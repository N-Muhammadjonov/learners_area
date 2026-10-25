import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { backendOrigin } from "./origin";
import type { CurrentUser } from "@/lib/auth/current-user";

/** Private UI-to-Python transport. Never exported from an API route. */
export async function backendServerCall<T>(path: string, body?: unknown): Promise<T> {
  const cookieHeader = (await cookies()).toString();
  const token = process.env.BACKEND_SERVICE_TOKEN;
  if (!token || token.length < 32) throw new Error("BACKEND_SERVICE_TOKEN is required");
  const headers = new Headers({ "x-backend-service-token": token, cookie: cookieHeader });
  const options: RequestInit = { headers, cache: "no-store", signal: AbortSignal.timeout(25_000) };
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    options.method = "POST";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(new URL(path, backendOrigin()), options);
  if (!response.ok) {
    const detail = await response.json().catch(() => ({})) as { code?: string; error?: string };
    const error = new Error(detail.error ?? "Backend request failed");
    if (detail.code && /^[A-Z0-9]{5}$/.test(detail.code)) Object.assign(error, { code: detail.code });
    throw error;
  }
  return await response.json() as T;
}

export const backendSession = cache(() => backendServerCall<{ user: CurrentUser | null; hasPhoto: boolean }>("/_frontend/session"));

export async function backendAction<T>(action: string, input: Record<string, unknown> = {}): Promise<T> {
  const response = await backendServerCall<{ result: T; dateKeys?: string[] }>("/_frontend/action", { action, ...input });
  if (response.result && typeof response.result === "object") {
    const record = response.result as Record<string, unknown>;
    for (const key of response.dateKeys ?? []) {
      if (typeof record[key] === "string") record[key] = new Date(record[key]);
    }
  }
  return response.result;
}
