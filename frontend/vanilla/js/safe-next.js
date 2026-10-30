/**
 * Where a sign-in may send you afterwards.
 *
 * `/login?next=…` is how the app remembers which private page a visitor wanted.
 * The value comes from the address bar, so it is attacker-controlled: without a
 * check, a link to `…/login?next=https://evil.example` would bounce a just-signed-in
 * student off the site, and `//evil.example` would do the same without even a
 * scheme. Only a path inside this application is ever honoured.
 *
 * Pure module — no server imports, so the login form can validate before it
 * navigates and the tests can exercise it directly.
 */
const MAX_LENGTH = 512;
export function safeNextPath(value) {
    if (!value)
        return null;
    let candidate = value.trim();
    if (candidate.length === 0 || candidate.length > MAX_LENGTH)
        return null;
    // Decode once so an encoded protocol-relative target (`/%2F%2Fevil.example`)
    // is judged by what it actually points at, not by how it was written.
    try {
        const decoded = decodeURIComponent(candidate);
        if (decoded !== candidate)
            candidate = decoded;
    }
    catch {
        return null; // malformed percent-escapes
    }
    if (!candidate.startsWith("/"))
        return null; // "https://evil", "javascript:", "evil"
    if (candidate.startsWith("//") || candidate.startsWith("/\\"))
        return null; // protocol-relative
    if (/[\\\u0000-\u001f\u007f]/.test(candidate))
        return null; // backslashes, control chars
    return candidate;
}
