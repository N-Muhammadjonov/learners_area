import type { GameSetKey } from "@/components/vocabulary/types";

export const GAME_IDS = ["cards", "choice", "match", "gap", "race", "translation", "builder"] as const;
export type GameId = (typeof GAME_IDS)[number];
export const GAME_SET_KEYS: readonly GameSetKey[] = ["all", "due", "weak", "reading", "listening", "topic", "folder", "assigned"];

export function isGameId(value: string): value is GameId {
  return (GAME_IDS as readonly string[]).includes(value);
}

export function isGameSetKey(value: string): value is GameSetKey {
  return (GAME_SET_KEYS as readonly string[]).includes(value);
}
