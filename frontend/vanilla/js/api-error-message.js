/**
 * Native counterpart of the original `apiErrorMessage` (src/lib/api-error-message.ts).
 * Server payloads (`{ error: "forbidden" }`, a code string, or nothing) become a
 * localized sentence. Raw codes are never shown to the learner.
 */
export function errorCode(raw) {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') {
    if (typeof raw.code === 'string') return raw.code;
    if (typeof raw.error === 'string') return raw.error;
  }
  return '';
}

export function apiErrorMessage(raw, status, dict, overrides) {
  const t = dict.apiErrors;
  const code = errorCode(raw);
  const specific = code ? overrides?.[code] : undefined;
  if (specific) return specific;
  switch (code) {
    case 'database_unavailable':
    case 'storage_not_configured':
    case 'storage_unavailable':
      return dict.uploadErrors?.[code] ?? t.generic;
    case 'unauthenticated':
      return t.unauthenticated;
    case 'forbidden':
      return t.forbidden;
    case 'not_found':
      return t.notFound;
    case 'rate_limited':
      return t.rateLimited;
    case 'conflict':
    case 'already_decided':
      return t.conflict;
    case 'upload_not_owned_or_finalized':
      return t.uploadNotReady ?? t.generic;
    case 'revision_managed':
      return t.revisionManaged ?? t.generic;
  }
  if (status === 401) return t.unauthenticated;
  if (status === 403) return t.forbidden;
  if (status === 404) return t.notFound;
  if (status === 409) return t.conflict;
  if (status === 429) return t.rateLimited;
  if (status === 400 || status === 422 || code === 'invalid_input') return t.invalid;
  return t.generic;
}
