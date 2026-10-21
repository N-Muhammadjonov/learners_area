import { redirect } from "next/navigation";
import { telegramIntentAuthEnabled } from "@/lib/auth/telegram-intent-config";
import { ProfileTelegramAccount } from "@/components/profile/ProfileTelegramAccount";
import {OnboardingForm} from "@/components/onboarding/OnboardingForm";
import {db} from "@/db/client";
import {users,telegramContacts,onboardingProfiles} from "@/db/schema";
import {eq} from "drizzle-orm";
import { hasProfilePhoto } from "@/lib/profile/photo";
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
  const [photoPresent,profile,identity]=await Promise.all([hasProfilePhoto(user.id),db.query.onboardingProfiles.findFirst({where:eq(onboardingProfiles.userId,user.id)}),db.select({telegramId:users.telegramId,username:telegramContacts.username,phone:telegramContacts.phoneNumber,verified:telegramContacts.phoneVerifiedAt}).from(users).leftJoin(telegramContacts,eq(telegramContacts.telegramUserId,users.telegramId)).where(eq(users.id,user.id)).then(rows=>rows[0])]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4" data-profile-page>
      <header>
        <h1 className="font-display text-2xl text-ink-900">{dict.profile.title}</h1>
        <p className="text-sm text-ink-500">{dict.profile.subtitle}</p>
      </header>
      <ProfilePhoto userId={user.id} dict={dict} initialPresent={photoPresent} />
      <ProfileNameEditor dict={dict} initialName={user.name} initiallyEditing={editName} />
      <section className="panel space-y-4"><h2 className="text-xl font-semibold">{dict.profile.studyTitle}</h2><OnboardingForm dict={dict} locale={locale} profile initial={profile?{...profile,examDate:profile.examDate?.toISOString().slice(0,10)??null}:undefined}/></section>
      {telegramIntentAuthEnabled()&&<ProfileTelegramAccount dict={dict} linked={!!identity?.telegramId} username={identity?.username??null} phone={identity?.verified?identity.phone:null} student={user.role==='student'} botUsername={process.env.TELEGRAM_BOT_USERNAME}/>}

    </div>
  );
}
