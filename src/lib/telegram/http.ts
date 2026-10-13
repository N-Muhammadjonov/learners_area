import { NextResponse } from "next/server";
import type { ActorDenial } from "./actor";

export function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export function actorError(error: ActorDenial) {
  if (error === "invalid_actor") return jsonError("invalid_actor", 400);
  if (error === "actor_not_linked") return jsonError("actor_not_linked", 409);
  return jsonError("forbidden", 403);
}

export async function readJson(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function clipText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export function correlationId(): string {
  return crypto.randomUUID();
}
