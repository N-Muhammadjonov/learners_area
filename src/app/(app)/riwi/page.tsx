import { notFound, redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale, isLocale } from "@/lib/i18n";
import { authorizeCapability } from "@/lib/services/riwi/capabilities";
import { getRiwiRoleSurface, unavailableRiwiRoleSurface } from "@/lib/services/riwi/role-surface";
import { riwiEnabledForRole } from "@/lib/services/riwi/rollout";
import { RiwiChat } from "@/components/riwi/RiwiChat";

export const dynamic = "force-dynamic";

export default async function RiwiPage() {
  const [user, requestLocale] = await Promise.all([requireActiveUser(), getLocale()]);
  if (!user) redirect("/login");
  const actor = { id: user.id, role: user.role, accountStatus: user.accountStatus };
  if (!riwiEnabledForRole(user.role) || !authorizeCapability(actor, "riwi.chat.self").allowed) notFound();
  const locale = isLocale(user.locale) ? user.locale : requestLocale;
  const dictionary = getDictionary(locale);
  const scopeSurface = await getRiwiRoleSurface(actor).catch(() => unavailableRiwiRoleSurface(user.role));
  return <RiwiChat key={`${user.id}:${user.role}`} role={user.role} locale={locale} scopeSurface={scopeSurface} labels={dictionary.riwiLab} />;
}
