"use client";

import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import type { RetentionTerminalPayload } from "@/lib/retention/types";
import { ResultView } from "@/components/reading/RetentionSession";

/** A durable, owner-scoped result opened by URL (refresh-safe, history-safe). */
export function RetentionResultStandalone({ dict, payload }: { dict: Dictionary; payload: RetentionTerminalPayload }) {
  const router = useRouter();
  return <ResultView dict={dict} payload={payload} onAnother={() => router.push("/reading/retention")} />;
}
