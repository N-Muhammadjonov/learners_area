import { redirect } from "next/navigation";

/**
 * RETIRED ROUTE. Shadowing is not part of the Learners Area product (owner decision).
 *
 * The URL is kept as a redirect rather than deleted so an existing bookmark or an old
 * link lands somewhere sensible instead of a dead end — the same convention this route
 * already used before the feature was briefly mounted. The destination deliberately
 * holds NO shadowing activity: /app/speaking/lessons filters the historical
 * `shadowing` material category out, so this redirect cannot reach the retired
 * feature directly or indirectly.
 */
export default function RetiredShadowingPage() {
  redirect("/app/speaking/lessons");
}
