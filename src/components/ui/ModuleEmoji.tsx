import type { ReactNode } from "react";
export type ModuleEmojiKind = "listening" | "reading" | "writing" | "speaking" | "grammar" | "vocabulary" | "video" | "eject";
// Original vector artwork: fixed appearance across platforms, no borrowed asset.
const marks: Record<ModuleEmojiKind, ReactNode> = {
 listening: <><path d="M6 15v-3a10 10 0 0 1 20 0v3"/><rect x="4" y="14" width="6" height="10" rx="3"/><rect x="22" y="14" width="6" height="10" rx="3"/></>,
 reading: <><path d="M16 8c-4-3-8-3-12-1v17c4-2 8-2 12 1 4-3 8-3 12-1V7c-4-2-8-2-12 1Z"/><path d="M16 8v17M8 12h4M20 12h4M8 16h4M20 16h4"/></>,
 writing: <><path d="m8 23 2-7L23 3l6 6-13 13-8 1ZM10 16l6 6M20 6l6 6M5 28h22"/></>,
 speaking: <><rect x="11" y="3" width="10" height="17" rx="5"/><path d="M6 15a10 10 0 0 0 20 0M16 25v4M11 29h10"/></>,
 grammar: <><path d="M14 6c-4-5-9-1-8 4-5 2-4 9 1 10-1 5 4 9 8 5V7M18 6c4-5 9-1 8 4 5 2 4 9-1 10 1 5-4 9-8 5V7M9 12l5 2M23 12l-5 2M10 21l4-3M22 21l-4-3"/></>,
 vocabulary: <><rect x="5" y="4" width="22" height="24" rx="4"/><path d="m10 22 6-13 6 13M12 18h8M9 4v5M23 4v5"/></>,
 video: <><rect x="3" y="6" width="26" height="20" rx="5"/><path d="m13 11 9 5-9 5Z"/></>,
 eject: <><path d="m7 19 9-13 9 13Z"/><path d="M7 25h18"/></>,
};
export function moduleEmojiFor(href: string): ModuleEmojiKind | null {
 const routes: Record<string, ModuleEmojiKind> = { "/listening":"listening", "/reading":"reading", "/writing":"writing", "/speaking":"speaking", "/grammar":"grammar", "/vocabulary":"vocabulary", "/video-lessons":"video" };
 return routes[href] ?? null;
}
export function ModuleEmoji({ kind, className = "" }: { kind: ModuleEmojiKind; className?: string }) {
 return <span className={`module-emoji ${className}`} aria-hidden="true"><svg viewBox="0 0 32 32" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" focusable="false">{marks[kind]}</svg></span>;
}
