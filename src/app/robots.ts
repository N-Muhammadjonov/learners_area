import type { MetadataRoute } from "next";
import { isPreviewDeployment, publicBaseUrl } from "@/lib/config/site";

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
        disallow: [
          "/api/",
          "/dashboard",
          "/courses",
          "/reading",
          "/listening",
          "/writing",
          "/speaking",
          "/grammar",
          "/vocabulary",
          "/mocks",
          "/coach",
          "/assignments",
          "/progress",
          "/live-classes",
          "/notifications",
          "/support",
          "/video-lessons",
          "/management",
          "/onboarding",
          "/pending",
          "/teacher",
          "/admin",
          "/owner",
        ],
      },
    ],
    ...(base ? { sitemap: `${base}/sitemap.xml`, host: base } : {}),
  };
}
