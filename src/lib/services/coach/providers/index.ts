import "server-only";
import type { EvaluationProvider } from "../types";

/**
 * Bundled provider adapters.
 *
 * === How to connect a new external AI evaluator (no core changes) ===
 *
 * 1. Create `src/lib/services/coach/providers/<your-provider>/index.ts`
 *    implementing `EvaluationProvider` (see `../types.ts`). Declare the
 *    capabilities it really has, and list the environment-variable NAMES it
 *    needs in `requiredSecrets`. Keep every vendor-specific field, header and
 *    response shape inside that folder.
 * 2. Import it here and add it to `bundledProviders`.
 * 3. Set its server-side credentials in the environment (never in `.env`
 *    committed to git, never with a `NEXT_PUBLIC_` prefix).
 * 4. Set `AI_PRIMARY_PROVIDER=<your-provider-id>` and deploy.
 *
 * Nothing else changes: no evaluation service, no route, no database column, no
 * UI component and no migration. If the provider fails, times out, returns a
 * malformed response or lacks the required capability, RIWI evaluates instead
 * and the result is labelled "Checked by RIWI".
 *
 * RIWI itself is not listed here — it is registered directly by the registry so
 * that it can never be un-registered or overridden by configuration.
 */
export const bundledProviders: readonly EvaluationProvider[] = [];
