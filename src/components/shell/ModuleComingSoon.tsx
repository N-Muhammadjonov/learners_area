import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";

export function ModuleComingSoon({
  title,
  body,
  ctaLabel,
}: {
  title: string;
  body: string;
  ctaLabel: string;
}) {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 font-display text-2xl text-ink-900">{title}</h1>
      <EmptyState
        icon="◐"
        title="Coming soon"
        body={body}
        action={
          <Link href="/writing">
            <Button variant="secondary">{ctaLabel}</Button>
          </Link>
        }
      />
    </div>
  );
}
