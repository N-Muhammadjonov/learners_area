import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getLocale, isLocale } from "@/lib/i18n";
import { riwiEnabledForRole } from "@/lib/services/riwi/rollout";
import { RiwiChat } from "@/components/riwi/RiwiChat";

export const dynamic = "force-dynamic";

export default async function RiwiPage() {
  const [user, requestLocale] = await Promise.all([getCurrentUser(), getLocale()]);
  if (!user) redirect("/login");
  if (!riwiEnabledForRole(user.role)) notFound();
  const locale = isLocale(user.locale) ? user.locale : requestLocale;
  return <RiwiChat role={user.role} locale={locale} />;
}
