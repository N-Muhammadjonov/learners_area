import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth/current-user";
import { isAdministrator, isStaff } from "@/lib/auth/roles";
import { getDictionary, getLocale } from "@/lib/i18n";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  IconAdmissions,
  IconAudit,
  IconChevronRight,
  IconContent,
  IconGrammar,
  IconListening,
  IconLive,
  IconPeople,
  IconPlay,
  IconReading,
  IconRetention,
  IconSettings,
  IconSpeaking,
  IconSupport,
  IconWriting,
} from "@/components/ui/icons";

export const metadata: Metadata = { title: "Management" };

/**
 * Management — the front door of the other half of the product.
 *
 * The owner asked for the learning navigation and the administrative one to stop
 * being the same list, and this is where the second one starts. It exists for
 * three reasons:
 *
 *   * it gives "Management" somewhere honest to go — a link into a mode, not
 *     into one arbitrary page that happened to exist;
 *   * it shows *what is available to this role*, and nothing else, so a teacher
 *     is not looking at an owner's tools;
 *   * it answers "what can I do here?" for an administrator the same way the
 *     module hubs answer it for a student, instead of dropping them into a table.
 *
 * Every card below is gated by the same role checks its route uses server-side.
 * The sidebar shows a narrower set — that is a layout decision, not a permission
 * one; both are backed by the guards in the routes themselves.
 */
export default async function ManagementPage() {
  // Staff only, with the same guard every other page in this mode uses: a
  // student or a pending applicant who types this URL (or follows an old
  // bookmark) is sent back to their own half of the product instead of being
  // shown a management shell with nothing in it. The mode is derived from the
  // route, so this page must refuse the learner role for the same reason
  // /admin/* and /teacher/* do.
  const staff = await requireStaff();
  if (!staff) redirect("/dashboard");

  const user = staff;

  const locale = await getLocale();
  const dict = getDictionary(locale);

  type Area = { href: string; title: string; body: string; icon: React.ReactNode };
  const areas: Area[] = [];
  const admin = isAdministrator(user.role);
  const owner = user.role === "owner";

  if (admin || owner) {
    areas.push(
      {
        href: "/admin/people",
        title: dict.nav.adminUsers,
        body: dict.management.peopleBody,
        icon: <IconPeople />,
      },
      {
        href: "/admin/admissions",
        title: dict.admission.title,
        body: dict.management.admissionsBody,
        icon: <IconAdmissions />,
      }
    );
  }

  if (isStaff(user.role)) {
    areas.push(
      {
        href: "/teacher/students",
        title: dict.nav.teacherStudents,
        body: dict.management.studentsBody,
        icon: <IconPeople />,
      },
      {
        href: "/teacher/support",
        title: dict.support.inbox,
        body: dict.management.supportBody,
        icon: <IconSupport />,
      },
      {
        href: "/teacher/live-classes",
        title: dict.liveClasses.manageTitle,
        body: dict.management.liveBody,
        icon: <IconLive />,
      },
      {
        href: "/teacher/speaking",
        title: dict.speaking.manageTitle,
        body: dict.management.speakingBody,
        icon: <IconSpeaking />,
      }
    );
  }

  if (admin) {
    areas.push(
      {
        href: "/admin/reading",
        title: dict.admin.readingTitle,
        body: dict.management.readingBody,
        icon: <IconReading />,
      },
      {
        href: "/admin/listening",
        title: dict.admin.listeningTitle,
        body: dict.management.listeningBody,
        icon: <IconListening />,
      },
      {
        href: "/admin/grammar",
        title: dict.admin.grammarTitle,
        body: dict.management.grammarBody,
        icon: <IconGrammar />,
      },
      {
        href: "/admin/writing-prompts",
        title: dict.nav.adminPrompts,
        body: dict.management.writingBody,
        icon: <IconWriting />,
      },
      {
        href: "/admin/video-lessons",
        title: dict.videoLessonAdmin.title,
        body: dict.management.videoBody,
        icon: <IconPlay />,
      },
      {
        href: "/admin/content",
        title: dict.nav.contentLibrary,
        body: dict.management.contentBody,
        icon: <IconContent />,
      }
    );
  }

  if (owner) {
    areas.push(
      {
        href: "/owner",
        title: dict.owner.title,
        body: dict.management.ownerBody,
        icon: <IconSettings />,
      },
      {
        href: "/owner/integrations",
        title: dict.owner.integrations,
        body: dict.management.integrationsBody,
        icon: <IconSettings />,
      },
      {
        href: "/owner/retention",
        title: dict.owner.retention,
        body: dict.management.retentionBody,
        icon: <IconRetention />,
      },
      {
        href: "/owner/audit",
        title: dict.owner.audit,
        body: dict.management.auditBody,
        icon: <IconAudit />,
      }
    );
  }

  return (
    <div className="flex flex-col gap-8" data-management-hub>
      <header className="flex flex-col gap-2">
        <h1 className="page-title">{dict.management.title}</h1>
        <p className="page-subtitle">{dict.management.subtitle}</p>
        <Link
          href="/dashboard"
          data-management-back
          className="mt-1 inline-flex w-fit min-h-[44px] items-center gap-2 rounded-[10px] border border-gold/45 bg-gold/10 px-3.5 text-[0.9375rem] font-medium text-ink-900 transition-colors hover:bg-gold/20"
        >
          <IconChevronRight className="rotate-180 text-[18px] text-gold" />
          {dict.management.backToLearning}
        </Link>
      </header>

      {areas.length === 0 ? (
        <EmptyState icon="⚙" title={dict.management.emptyForRole} />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {areas.map((area) => (
            <Link
              key={area.href}
              href={area.href}
              data-management-area={area.href}
              className="panel group flex min-h-[150px] flex-col gap-3 transition-colors hover:border-gold/45 hover:bg-paper-sunken"
            >
              <span
                aria-hidden
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-ink-100 bg-paper-sunken text-[22px] text-gold"
              >
                {area.icon}
              </span>
              <span className="card-title">{area.title}</span>
              <span className="body-text flex-1 text-[0.9375rem]">{area.body}</span>
              <span className="inline-flex items-center gap-1.5 text-[0.875rem] font-medium text-ink-500 group-hover:text-ink-900">
                <IconChevronRight className="text-[16px]" />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
