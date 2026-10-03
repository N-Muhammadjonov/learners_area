import { redirect } from "next/navigation";

/** Legacy route: the canonical Writing Management area owns exam prompts now. Old bookmarks land there. */
export default function LegacyWritingPromptsPage() {
  redirect("/admin/writing?section=exam");
}
