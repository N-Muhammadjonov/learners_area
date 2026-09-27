import type { MetadataRoute } from "next";
import { isPreviewDeployment, publicBaseUrl } from "@/lib/config/site";

export const dynamic = "force-dynamic";

/**
 * The public sitemap.
 *
 * It intentionally contains only pages a stranger may read: the landing page and
 * the two ways in. Private routes, student data, reports and the admin/owner
 * surfaces are never listed — a sitemap entry is an invitation to index, and the
 * centre's content is not public.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  if (!publicBaseUrl || isPreviewDeployment) return [];
  const now = new Date();
  return [
    { url: `${publicBaseUrl}/`, lastModified: now, changeFrequency: "monthly", priority: 1 },
    { url: `${publicBaseUrl}/login`, lastModified: now, changeFrequency: "yearly", priority: 0.5 },
    { url: `${publicBaseUrl}/register`, lastModified: now, changeFrequency: "yearly", priority: 0.5 },
  ];
}
