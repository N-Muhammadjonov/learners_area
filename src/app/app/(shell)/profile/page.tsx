import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users, userProfilePhotos } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { ProfilePhoto } from "@/components/profile/ProfilePhoto";
import { ProfileNameEditor } from "@/components/profile/ProfileNameForm";

export const dynamic = "force-dynamic";

/**
 * Whether this learner actually has a stored profile photo.
 *
 * The avatar endpoint answers 404 when there is no photo, which is the right contract for an
 * image route. But the page is rendered server-side, so it can settle that question before the
 * browser asks it: without this the client mounted an <img> pointing at a URL that was always
 * going to fail, logged a console error on every learner who had never uploaded a photo, and
 * showed the placeholder only after the failed request came back.
 *
 * Failure here must not break the profile page, so an unreadable answer degrades to `true` and
 * the component falls back to its previous probe-and-recover behaviour.
 */
async function hasProfilePhoto(userId: string): Promise<boolean> {
  try {
    const ready = await db.execute(sql`select to_regclass('public.user_profile_photos') as ready`);
    if (!ready.rows[0]?.ready) return false;
    const [row] = await db
      .select({ found: sql<number>`1` })
      .from(userProfilePhotos)
      .innerJoin(users, eq(users.id, userProfilePhotos.userId))
      .where(and(eq(users.id, userId), eq(users.accountStatus, "active")))
      .limit(1);
    return Boolean(row?.found);
  } catch {
    return true;
  }
}

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale()]);
  if (!user) redirect("/login");
  const dict = getDictionary(locale);
  // "Edit name" from the profile menu arrives here already opened.
  const editName = (await searchParams)?.edit === "name";
  const photoPresent = await hasProfilePhoto(user.id);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4" data-profile-page>
      <header>
        <h1 className="font-display text-2xl text-ink-900">{dict.profile.title}</h1>
        <p className="text-sm text-ink-500">{dict.profile.subtitle}</p>
      </header>
      <ProfilePhoto userId={user.id} dict={dict} initialPresent={photoPresent} />
      <ProfileNameEditor dict={dict} initialName={user.name} initiallyEditing={editName} />
    </div>
  );
}
