import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { ProfileNameForm } from "@/components/profile/ProfileNameForm";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale()]);
  if (!user) redirect("/login");
  const dict = getDictionary(locale);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4" data-profile-page>
      <header>
        <h1 className="font-display text-2xl text-ink-900">{dict.profile.title}</h1>
        <p className="text-sm text-ink-500">{dict.profile.subtitle}</p>
      </header>
      <ProfileNameForm dict={dict} initialName={user.name} />
    </div>
  );
}
