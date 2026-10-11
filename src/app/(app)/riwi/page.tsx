import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, LOCALE_COOKIE } from "@/lib/i18n";
import { riwiPresentationLocale } from "@/lib/services/riwi/locale";
import { authorizeCapability } from "@/lib/services/riwi/capabilities";
import { getRiwiRoleSurface, unavailableRiwiRoleSurface } from "@/lib/services/riwi/role-surface";
import { riwiEnabledForRole } from "@/lib/services/riwi/rollout";
import { RiwiChat } from "@/components/riwi/RiwiChat";

export const dynamic = "force-dynamic";

export default async function RiwiPage() {
  const [user, requestCookies] = await Promise.all([requireActiveUser(), cookies()]);
  if (!user) redirect("/login");
  const actor = { id: user.id, role: user.role, accountStatus: user.accountStatus };
  if (!riwiEnabledForRole(user.role) || !authorizeCapability(actor, "riwi.chat.self").allowed) notFound();
  const locale = riwiPresentationLocale(requestCookies.get(LOCALE_COOKIE)?.value, user.locale);
  const dictionary = getDictionary(locale);
  const scopeSurface = await getRiwiRoleSurface(actor).catch(() => unavailableRiwiRoleSurface(user.role));
  return <RiwiChat key={`${user.id}:${user.role}`} role={user.role} locale={locale} scopeSurface={scopeSurface} labels={dictionary.riwiLab} />;
}
