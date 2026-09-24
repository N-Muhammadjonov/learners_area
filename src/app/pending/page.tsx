import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasPrivateAccess } from "@/lib/auth/account-status";
import { findOpenRequestForUser } from "@/lib/data/admission";
import { getDictionary, getLocale } from "@/lib/i18n";
import { AuthShell } from "@/components/auth/AuthShell";
import { AccessRequestForm } from "@/components/admission/AccessRequestForm";
import { LogoutButton } from "@/components/shell/LogoutButton";

export const dynamic = "force-dynamic";

/**
 * The waiting room for a private learning centre.
 *
 * Everything here is server-rendered from the database row: an approved account
 * that lands on this URL is sent straight inside, and a visitor who is not
 * signed in is sent to the login page. The status is never read from the
 * cookie, so re-opening an old tab cannot show a stale "approved" state.
 */
export default async function PendingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (hasPrivateAccess(user.accountStatus)) redirect("/dashboard");

  const dict = getDictionary(getLocale());
  const t = dict.admission;
  const openRequest = await findOpenRequestForUser(user.id);

  const heading =
    user.accountStatus === "suspended"
      ? t.suspendedTitle
      : user.accountStatus === "rejected"
        ? t.rejectedTitle
        : t.title;

  const body =
    user.accountStatus === "suspended"
      ? t.suspendedBody
      : user.accountStatus === "rejected"
        ? t.rejectedBody
        : t.subtitle;

  return (
    <AuthShell
      title={heading}
      subtitle={body}
      footer={
        <div className="flex items-center justify-center gap-3">
          <span>{user.name}</span>
          <LogoutButton label={t.signOut} />
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="rounded-sm bg-paper-sunken p-3 text-xs leading-relaxed text-ink-500">
          {t.explainer}
        </p>

        <div className="flex items-center justify-between rounded-sm border border-ink-100 px-3 py-2">
          <span className="text-sm text-ink-700">{t.statusPending}</span>
          <span
            className={
              user.accountStatus === "pending"
                ? "badge bg-band-warn/10 text-band-warn"
                : "badge bg-band-bad/10 text-band-bad"
            }
            data-account-status={user.accountStatus}
          >
            {user.accountStatus === "pending"
              ? t.statusPending
              : user.accountStatus === "suspended"
                ? t.statusSuspended
                : t.statusRejected}
          </span>
        </div>

        {user.accountStatus === "pending" ? (
          <p className="text-sm text-ink-500">{openRequest ? t.requestOpen : t.requestSent}</p>
        ) : (
          <AccessRequestForm
            dict={dict}
            alreadyRequested={Boolean(openRequest)}
            canRequest={user.accountStatus === "rejected"}
          />
        )}

        <Link href="/" className="text-center text-xs text-signal-600 hover:underline">
          {dict.common.backToSite}
        </Link>
      </div>
    </AuthShell>
  );
}
