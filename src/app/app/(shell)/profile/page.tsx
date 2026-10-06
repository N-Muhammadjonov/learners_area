import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { ProfilePhoto } from "@/components/profile/ProfilePhoto";
import { ProfileNameEditor } from "@/components/profile/ProfileNameForm";

export const dynamic = "force-dynamic";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale()]);
  if (!user) redirect("/login");
  const dict = getDictionary(locale);
  // "Edit name" from the profile menu arrives here already opened.
  const editName = (await searchParams)?.edit === "name";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4" data-profile-page>
      <header>
        <h1 className="font-display text-2xl text-ink-900">{dict.profile.title}</h1>
        <p className="text-sm text-ink-500">{dict.profile.subtitle}</p>
      </header>
      <ProfilePhoto userId={user.id} dict={dict} />
      <ProfileNameEditor dict={dict} initialName={user.name} initiallyEditing={editName} />
    </div>
  );
}
