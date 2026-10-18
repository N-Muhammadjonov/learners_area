import { redirect } from "next/navigation";

/** Preserve existing catalogue bookmarks on the canonical Listening Tests route. */
export default function LegacyAcademicListeningPage() {
  redirect("/app/listening/tests");
}
