import Link from "next/link";
import { getMockOverview } from "@/lib/data/mocks";
import { summarizeMocks } from "@/lib/progress/mock-summary";
import { MockBandPanel } from "./MockBandPanel";
import { RegionFailureNotice } from "@/components/interaction/RegionFailureNotice";
export async function MockProgressOverview({
  userId,
  locale,
  dashboard = false,
}: {
  userId: string;
  locale: string;
  dashboard?: boolean;
}) {
  const uz = locale === "uz";
  const failure = (
    <RegionFailureNotice
      region="mock-overview"
      message={
        uz
          ? "Mock natijalarini yuklab bo'lmadi."
          : "Mock results could not be loaded."
      }
      retryLabel={uz ? "Qayta urinish" : "Retry"}
    />
  );
  let data;
  try {
    data = await getMockOverview(userId);
  } catch {
    return failure;
  }
  if (data.attemptsUnavailable || data.attemptTitlesUnavailable) return failure;
  const summary = summarizeMocks(
    data.attempts,
    data.tests.filter((t) => t.skill === "full").map((t) => t.id),
  );
  const chart = <MockBandPanel summary={summary} uz={uz} compact={dashboard} />;
  if (!dashboard)
    return (
      <div className="space-y-3">
        {data.catalogueUnavailable && failure}
        {chart}
      </div>
    );
  return (
    <section className="space-y-4" data-dashboard-mock-overview>
      <div className="grid items-start gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="card space-y-4">
          <h2 className="font-display text-2xl font-bold">
            📝 {uz ? "Mock testlar" : "Mock tests"}
          </h2>
          <p>
            {uz
              ? "Haqiqiy urinishlaringiz va mavjud testlar."
              : "Your actual attempts and available tests."}
          </p>
          <Link href="/mocks" className="btn-primary">
            {uz ? "Mock testlarni ochish" : "Open mock tests"} →
          </Link>
          {data.catalogueUnavailable ? (
            failure
          ) : (
            <p>
              {data.tests.length} {uz ? "ta test mavjud" : "tests available"}
            </p>
          )}
        </div>
        {chart}
      </div>
      <div className="card overflow-x-auto">
        <h3 className="mb-3 font-bold">
          {uz ? "Hozirgacha natijalar" : "Results so far"}
        </h3>
        {data.attempts.length ? (
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th>Mock</th>
                <th>{uz ? "Sana" : "Date"}</th>
                <th>{uz ? "Bo'lim" : "Module"}</th>
                <th>Band</th>
              </tr>
            </thead>
            <tbody>
              {data.attempts.slice(0, 8).map((a) => (
                <tr key={a.id}>
                  <td className="py-3">{a.title ?? "Mock"}</td>
                  <td>{a.startedAt?.toISOString().slice(0, 10) ?? "—"}</td>
                  <td>{a.skill ?? "—"}</td>
                  <td>{a.estimatedBand ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>{uz ? "Hali mock urinishlari yo'q." : "No mock attempts yet."}</p>
        )}
      </div>
    </section>
  );
}
