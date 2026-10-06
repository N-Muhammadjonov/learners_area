import type { MetadataRoute } from "next";
import { isPreviewDeployment, publicBaseUrl } from "@/lib/config/site";
import { ACCOUNT_GATED_PATHS, APP_HOME, PRIVATE_MODULE_SEGMENTS } from "@/lib/nav/private-modules.mjs";

export const dynamic = "force-dynamic";

/**
 * Search engines may index the public front door and nothing else.
 *
 * Everything behind `/login` is a private learning centre: dashboards, courses,
 * student work, reports and the admin/owner surfaces. Those are listed as
 * disallowed here *and* rendered with `noindex` (see the private layout), so a
 * crawler that reaches one through a shared link still does not publish it.
 */
export default function robots(): MetadataRoute.Robots {
  if (isPreviewDeployment) return { rules: { userAgent: "*", disallow: "/" } };
  const base = publicBaseUrl ?? undefined;
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/$", "/login", "/register"],
        // Derived from the shared private-module table: `/app` covers the whole
        // canonical namespace, and the historical top-level segments are listed so
        // a crawler that still knows the old URLs is told they are private too.
        disallow: [
          "/api/",
          APP_HOME,
          ...ACCOUNT_GATED_PATHS,
          ...PRIVATE_MODULE_SEGMENTS.map((segment) => `/${segment}`),
        ],
      },
    ],
    ...(base ? { sitemap: `${base}/sitemap.xml`, host: base } : {}),
  };
}
