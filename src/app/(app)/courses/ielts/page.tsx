import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getCourseRoadmap } from "@/lib/data/roadmap";
import { Card } from "@/components/ui/Card";
import { StateBadge } from "@/components/ui/Badge";

export default async function IeltsRoadmapPage() {
  const session = await getSession();
  if (!session) return null;
  const dict = getDictionary(getLocale());
  const roadmap = await getCourseRoadmap("ielts", session.sub);
  if (!roadmap) notFound();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl text-ink-900">{roadmap.course.title}</h1>
        <p className="text-sm text-ink-500">{roadmap.course.description}</p>
      </div>

      {roadmap.modules.map((m) => (
        <div key={m.id}>
          <h2 className="mb-2 font-display text-lg text-ink-900">{m.title}</h2>
          <div className="flex flex-col gap-2">
            {m.units.map((u) => (
              <Card key={u.id}>
                <p className="mb-2 text-sm font-medium text-ink-700">{u.title}</p>
                <div className="flex flex-col divide-y divide-ink-100">
                  {u.lessons.map((l) => (
                    <div key={l.id} className="flex items-center justify-between py-2">
                      <div>
                        <p className="text-sm text-ink-900">{l.title}</p>
                        {l.summary && <p className="text-xs text-ink-300">{l.summary}</p>}
                      </div>
                      <StateBadge state={l.state} />
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
