import "server-only";
import { cache } from "react";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { userProfilePhotos } from "@/db/schema";

/**
 * Whether this learner actually has a stored profile photo.
 *
 * The avatar endpoint answers 404 when there is no photo, which is the right contract for an
 * image route. But the page is rendered server-side, so it can settle that question before the
 * browser asks it: without this the client mounted an <img> pointing at a URL that was always
 * going to fail, logged a console error on every learner who had never uploaded a photo, and
 * showed the placeholder only after the failed request came back.
 *
 * Failure here must not break the profile page, so an unreadable answer degrades to `true` and
 * the component falls back to its previous probe-and-recover behaviour.
 */
export const hasProfilePhoto = cache(async (userId: string): Promise<boolean> => {
  try {
    // The enclosing /app layout has already checked accountStatus against the
    // authoritative users row. Avoid TWO more sequential PG round trips for
    // a purely decorative avatar; a missing/unavailable table uses the client
    // fallback exactly as before. Never use this flag to authorize anything.
    const [row] = await db
      .select({ found: sql<number>`1` })
      .from(userProfilePhotos)
      .where(eq(userProfilePhotos.userId, userId))
      .limit(1);
    return Boolean(row?.found);
  } catch {
    return true;
  }
});
