import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { BRAND } from "@/lib/config/brand";
import { THEME_COOKIE, type Theme } from "@/components/shell/ThemeToggle";
import { getLocale } from "@/lib/i18n";

export const metadata: Metadata = {
  title: BRAND.siteName,
  description: BRAND.tagline,
};

function readTheme(): Theme {
  const raw = cookies().get(THEME_COOKIE)?.value;
  return raw === "night" ? "night" : "day";
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // The theme is resolved on the server so the first paint already has the right
  // palette: no flash of a white page for a reader who chose Night Mode.
  const theme = readTheme();
  return (
    <html lang={getLocale()} data-theme={theme} data-focus="off">
      <body>{children}</body>
    </html>
  );
}
