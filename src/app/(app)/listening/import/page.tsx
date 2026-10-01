import { listeningSchemaReady } from "@/lib/data/listening-schema-ready";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActiveUser, isStaff } from "@/lib/auth/current-user";
import { ListeningImport } from "@/components/listening/ListeningImport";
export default async function ImportPage() {
  const user = await requireActiveUser();
  if (!user || !isStaff(user.role)) redirect("/dashboard");
  if (!(await listeningSchemaReady()))
    return (
      <div className="card mx-auto max-w-4xl space-y-4">
        <h1 className="font-display text-2xl">Listening import</h1>
        <p role="status">
          Import vaqtincha mavjud emas. QA baza yangilanishi tugagach import
          ochiladi; faylingizni hozir yuklamang.
        </p>
        <Link className="btn-secondary" href="/listening">
          ← Listening
        </Link>
      </div>
    );
  return (
    <div className="mx-auto max-w-4xl">
      <ListeningImport />
    </div>
  );
}
