import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { BRAND, BRAND_ASSETS } from "@/lib/config/brand";
import { THEME_COOKIE, themeFromCookie } from "@/lib/theme";
import { getLocale } from "@/lib/i18n";

export const metadata: Metadata = {
  title: BRAND.siteName,
  description: BRAND.tagline,
  /**
   * Browser identity comes from the approved brand asset, declared here rather
   * than copied into `app/icon.png`: one canonical file, one path (BrandConfig).
   * Without an explicit icon Next.js would keep serving the framework default,
   * which is not the centre's mark.
   */
  icons: {
    icon: [{ url: BRAND_ASSETS.favicon, type: "image/png" }],
    apple: [{ url: BRAND_ASSETS.favicon, type: "image/png" }],
    shortcut: [{ url: BRAND_ASSETS.favicon, type: "image/png" }],
  },
};

/**
 * Phone behaviour, declared once.
 *
 * `interactiveWidget: "resizes-content"` is what keeps a form usable on a phone:
 * when the on-screen keyboard opens, the layout viewport shrinks so the focused
 * input stays on screen instead of sitting behind the keyboard. `viewportFit:
 * "cover"` plus the safe-area padding in the app shell keeps controls clear of
 * the notch and the home indicator. No `maximumScale` — pinch-zoom stays allowed.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

async function readTheme() {
  // `cookies()` is async in Next 15; the theme still resolves on the server, so
  // the first paint already carries the right one.
  return themeFromCookie((await cookies()).get(THEME_COOKIE)?.value);
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The theme is resolved on the server so the first paint already has the right
  // palette: no flash of a white page for a reader who chose Night Mode.
  const theme = await readTheme();
  return (
    <html lang={await getLocale()} data-theme={theme} data-focus="off">
      <body>{children}</body>
    </html>
  );
}
