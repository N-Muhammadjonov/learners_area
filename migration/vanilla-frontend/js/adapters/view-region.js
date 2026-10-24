import {ApiError} from '../api-client.js';

/**
 * Reads one region from the established `/api/frontend/view` envelope:
 *   { version: 1, route, region, data: { [region]: payload } }
 * The same checks as `viewData` in frontend.js. Any mismatch fails closed (502) and never renders.
 */
export function regionPayload(raw, route, region) {
  const ok = !!raw && typeof raw === 'object' && !Array.isArray(raw)
    && raw.version === 1 && raw.route === route && raw.region === region
    && !!raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)
    && raw.data[region] !== undefined;
  if (!ok) throw new ApiError(502, 'invalid_view_adapter');
  return raw.data[region];
}
