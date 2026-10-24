import "server-only";
import { cache } from "react";
import { backendSession } from "@/lib/backend/server";

export const hasProfilePhoto = cache(async (userId: string): Promise<boolean> => {
  try {
    const session = await backendSession();
    return session.user?.id === userId && session.hasPhoto;
  } catch {
    return true;
  }
});
