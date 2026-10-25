import { CampusWorld } from "@/components/campus/CampusWorld";
import { requireStaff } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import "@/components/campus/campus.css";

/** The learning home now opens into the immersive 3D campus.
 * The previous data-rich dashboard remains unchanged at /app/dashboard.
 * Every module continues to use its original route and UI. */
export default async function LearningCampusPage() {
  const [staff, locale] = await Promise.all([requireStaff(), getLocale()]);
  return <CampusWorld showManagement={Boolean(staff)} managementLabel={getDictionary(locale).nav.management} />;
}
