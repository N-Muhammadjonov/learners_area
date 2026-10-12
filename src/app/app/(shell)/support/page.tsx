import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { Card } from "@/components/ui/Card";
import { ReportProblem } from "@/components/support/ReportProblem";
import { isStaff } from "@/lib/auth/roles";

export const metadata = { title: "Support" };

/**
 * /support — the destination behind the sidebar's Support entry.
 *
 * That entry used to point at a page that did not exist, so the one place a
 * student is sent when something goes wrong answered 404. This page does two
 * things and nothing else: it carries the report form (the same component the
 * floating button uses, so both send the same context), and it says where else
 * help comes from. A staff member additionally gets the inbox link.
 */
export default async function SupportPage() {
  const user = await requireActiveUser();
  if (!user) return null;
  const dict = getDictionary(await getLocale());

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4" data-support-page>
      <h1 className="font-display text-2xl text-ink-900">{dict.support.title}</h1>
      <p className="body-text">{dict.support.subtitle}</p>

      <Card className="flex flex-col gap-3">
        <ReportProblem dict={dict} />
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="card-title">{dict.support.otherWaysTitle}</h2>
        <p className="body-text">{dict.support.otherWaysBody}</p>
        {isStaff(user.role) && (
          <Link href="/app/teacher/support" className="btn-secondary self-start" data-support-inbox>
            {dict.support.inbox}
          </Link>
        )}
      </Card>
    </div>
  );
}
