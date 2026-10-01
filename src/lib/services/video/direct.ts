import "server-only";
import { authorizedMediaOrigin } from "@/lib/config/site";
import { DIRECT_MEDIA_ID, directMediaUrls } from "@/lib/services/video/provider";

/** URLs for an authorised direct media item, or null (not direct / origin not configured / bad id). */
export function resolveDirectMedia(provider: string, videoId: string, origin = authorizedMediaOrigin) {
  if (provider !== "direct" || !origin || !DIRECT_MEDIA_ID.test(videoId)) return null;
  return directMediaUrls(videoId, origin);
}
