# RIWI final authenticated browser QA

Status: **EXTERNAL REQUIRED — not executed**.

No deployed Preview URL, exact deployment receipt, Preview database/object target, or active four-role QA identity set is available in this workspace. A build, JSDOM/UI test, or direct API request is not browser acceptance.

After D-05 authorization, record the exact branch/SHA/environment and complete this matrix in English and Uzbek at desktop and mobile viewports:

| Flow | Student | Teacher | Admin | Owner |
|---|---|---|---|---|
| Direct `/owner/riwi` access | must deny | must deny | must deny | allow |
| Owner RIWI readiness/security panel | no disclosure | no disclosure | no owner action | render real state |
| Assessment candidate/preview | deny | deny | deny | consequential action succeeds |
| Approve exact regression | deny | deny | deny | valid succeeds; stale/modified rejects |
| Reject candidate | deny | deny | deny | succeeds |
| Owner-only APIs | 401/403/404 policy | same | same | scoped response |
| Stale session/logout/login | deny after expiry | deny after expiry | deny after expiry | deny after expiry, recover after login |
| CSRF/IDOR/cross-role attempt | reject | reject | reject owner mutation | reject foreign IDs |
| Refresh/back/forward | no leakage | no leakage | no leakage | stable, no replay |

Also capture network status, absence of private payload leakage, signed-resource expiry, and repeated navigation behavior. Until this is executed against the exact deployment SHA, status remains EXTERNAL REQUIRED.
