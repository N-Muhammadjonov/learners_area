import { redirect } from "next/navigation";
import { requireAdministrator } from "@/lib/auth/current-user";
import { listPendingAccessRequests, listRecentDecisions } from "@/lib/data/admission";
import { getDictionary, getLocale } from "@/lib/i18n";
import { AdmissionQueue } from "@/components/admin/AdmissionQueue";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

/**
 * The admission queue for a private learning centre.
 *
 * The owner and admins work this list; nobody else can open the page (the
 * database role is checked here) and nobody else can act on it (the API checks
 * again).
 */
export default async function AdminAdmissionsPage() {
  const actor = await requireAdministrator();
  if (!actor) redirect("/app");

  const dict = getDictionary(await getLocale());
  const [pending, recent] = await Promise.all([
    listPendingAccessRequests(),
    listRecentDecisions(10),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl text-ink-900">{dict.admission.title}</h1>
        <p className="text-sm text-ink-500">{dict.admission.explainer}</p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg text-ink-900">
          {dict.admission.queueTitle}
          {pending.length > 0 && (
            <span className="ml-2 badge bg-band-warn/10 text-band-warn" data-pending-count>
              {pending.length}
            </span>
          )}
        </h2>
        <AdmissionQueue dict={dict} requests={pending} />
      </section>

      {recent.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-lg text-ink-900">{dict.admission.recentTitle}</h2>
          <Card className="flex flex-col gap-2">
            {recent.map((request) => (
              <div key={request.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-ink-700">{request.applicantName}</span>
                <span className="text-xs text-ink-300">
                  {request.decidedAt ? request.decidedAt.toISOString().slice(0, 10) : "—"}
                </span>
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}
