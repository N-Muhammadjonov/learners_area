import Link from "next/link";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listStudents } from "@/lib/data/teacher";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export default async function TeacherStudentsPage() {
  const dict = getDictionary(getLocale());
  const students = await listStudents();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="font-display text-2xl text-ink-900">{dict.teacher.studentsTitle}</h1>

      {students.length === 0 && <EmptyState icon="○" title={dict.teacher.noStudents} />}

      <div className="flex flex-col gap-2">
        {students.map((s) => (
          <Link key={s.id} href={`/teacher/students/${s.id}`}>
            <Card className="flex items-center justify-between hover:border-signal-400">
              <div>
                <p className="text-sm font-medium text-ink-900">{s.name}</p>
                <p className="text-xs text-ink-300">{s.email ?? "Telegram account"}</p>
              </div>
              <span className="text-xs text-ink-300">{s.onboardingCompletedAt ? "Onboarded" : "New"}</span>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
