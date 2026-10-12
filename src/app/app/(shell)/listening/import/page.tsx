import { redirect } from "next/navigation";
import { requireAdministrator } from "@/lib/auth/current-user";

// Old learner-area import URL: administrators go to Management, everyone else
// to the Listening hub. No import UI is rendered here any more.
export default async function LegacyListeningImportRedirect() {
  const administrator = await requireAdministrator();
  redirect(administrator ? "/app/admin/listening/import" : "/app/listening");
}
