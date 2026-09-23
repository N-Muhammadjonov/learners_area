import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getLocale, getDictionary } from "@/lib/i18n";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const locale = getLocale();
  const dict = getDictionary(locale);

  return (
    <div className="flex min-h-screen">
      <Sidebar dict={dict} role={session.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar dict={dict} locale={locale} userName={session.name} role={session.role} />
        <main className="flex-1 bg-paper p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
