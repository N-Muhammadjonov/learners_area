/** Shared Node/Workers wire protocol. No environment access or Node imports. */
export type MediaClaims = {
  v: 1; aud: 'learnersarea-media'; uid: string; authVersion: number;
  sessionKey: string; sessionExpiresAt: number; key: string; exp: number;
};
export type MediaAuthorizationRequest = {
  method: 'GET' | 'HEAD'; token: string; key: string; timestamp: number; proof: string;
};
export const MEDIA_TTL_SECONDS = 120;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true,ignoreBOM:true});
export function safeMediaKey(key: string): boolean {
  return key.length > 0 && key.length <= 400 && /^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(key) &&
    !key.includes('..') && key.split('/').every(segment => segment !== '' && segment !== '.');
}
export function encodeMediaKey(value: string): string {
  return base64url(encoder.encode(value));
}
export function decodeMediaKey(value: string): string | null {
  try { const decoded = decoder.decode(unbase64url(value)); return safeMediaKey(decoded) ? decoded : null; }
  catch { return null; }
}
function base64url(bytes: Uint8Array): string {
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function unbase64url(value: string): Uint8Array {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw Error('invalid_encoding');
  const raw = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  if (base64url(bytes) !== value) throw Error('noncanonical_encoding');
  return bytes;
}
function canonical(c: MediaClaims): string {
  return JSON.stringify([c.v,c.aud,c.uid,c.authVersion,c.sessionKey,c.sessionExpiresAt,c.key,c.exp]);
}
async function keyOf(secret: string, usage: KeyUsage[]) {
  if (encoder.encode(secret).length < 32) throw Error('invalid_media_configuration');
  return crypto.subtle.importKey('raw', encoder.encode(secret), {name:'HMAC',hash:'SHA-256'}, false, usage);
}
async function sign(secret: string, value: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', await keyOf(secret,['sign']),encoder.encode(value))));
}
async function verify(secret: string, value: string, signature: string): Promise<boolean> {
  try { const bytes = unbase64url(signature); return bytes.byteLength === 32 && await crypto.subtle.verify('HMAC',await keyOf(secret,['verify']),bytes,encoder.encode(value)); }
  catch { return false; }
}
function valid(c: MediaClaims, now: number): boolean {
  return c.v === 1 && c.aud === 'learnersarea-media' && typeof c.uid === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(c.uid) &&
    Number.isSafeInteger(c.authVersion) && c.authVersion >= 0 && typeof c.sessionKey === 'string' &&
    /^[a-f0-9]{64}$/.test(c.sessionKey) && typeof c.key === 'string' && safeMediaKey(c.key) &&
    Number.isSafeInteger(c.exp) && Number.isSafeInteger(c.sessionExpiresAt) &&
    c.exp > now && c.exp <= now + MEDIA_TTL_SECONDS && c.sessionExpiresAt >= c.exp;
}
export async function createMediaCapability(secret: string, scope: Omit<MediaClaims,'v'|'aud'|'exp'>,
  options: {now?: number; ttlSeconds?: number} = {}): Promise<{token:string;claims:MediaClaims}> {
  const now = options.now ?? Math.floor(Date.now()/1000);
  const ttl = Math.max(1,Math.min(MEDIA_TTL_SECONDS,Math.floor(options.ttlSeconds ?? MEDIA_TTL_SECONDS)));
  const claims: MediaClaims = {...scope,v:1,aud:'learnersarea-media',exp:Math.min(now+ttl,scope.sessionExpiresAt)};
  if (!valid(claims,now)) throw Error('invalid_media_scope');
  const payload = encodeMediaKey(canonical(claims));
  return {token:payload+'.'+await sign(secret,'la-media-read-v1\n'+payload),claims};
}
export async function verifyMediaCapability(secret: string, token: string, key: string,
  now = Math.floor(Date.now()/1000)): Promise<MediaClaims|null> {
  try {
    if (typeof token !== 'string' || token.length > 2400 || !safeMediaKey(key)) return null;
    const parts = token.split('.'); if (parts.length !== 2) return null;
    const payload=parts[0]!,signature=parts[1]!;
    if (!await verify(secret,'la-media-read-v1\n'+payload,signature)) return null;
    const raw = decoder.decode(unbase64url(payload));
    const list: unknown = JSON.parse(raw); if (!Array.isArray(list) || list.length !== 8) return null;
    const [v,aud,uid,authVersion,sessionKey,sessionExpiresAt,resource,exp] = list;
    const claims = {v,aud,uid,authVersion,sessionKey,sessionExpiresAt,key:resource,exp} as MediaClaims;
    return valid(claims,now) && claims.key === key && canonical(claims) === raw ? claims : null;
  } catch { return null; }
}
function proofPayload(input: Pick<MediaAuthorizationRequest,'method'|'token'|'timestamp'>): string {
  return JSON.stringify(['la-media-backchannel-v1',input.method,input.token,input.timestamp]);
}
export async function createMediaAuthorizationProof(secret: string, input: Pick<MediaAuthorizationRequest,'method'|'token'|'timestamp'>): Promise<string> {
  return sign(secret,proofPayload(input));
}
export async function verifyMediaAuthorizationProof(secret: string, input: Omit<MediaAuthorizationRequest,'key'>,
  now = Math.floor(Date.now()/1000)): Promise<boolean> {
  return (input.method === 'GET' || input.method === 'HEAD') && typeof input.token === 'string' &&
    input.token.length <= 2400 && Number.isSafeInteger(input.timestamp) && Math.abs(now-input.timestamp) <= 30 &&
    typeof input.proof === 'string' && await verify(secret,proofPayload(input),input.proof);
}
export function mediaCapabilityUrl(workerBase: string, key: string, token: string): string {
  const url = new URL('/v1/media/'+encodeMediaKey(key),workerBase); url.searchParams.set('token',token); return url.toString();
}
/** Single byte ranges only: rejects unsafe integers, empty objects and multipart. */
export function parseMediaRange(header: string, size: number): {start:number;end:number}|null {
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim()); if (!match || (!match[1]&&!match[2])) return null;
  if (!match[1]) { const length=Number(match[2]); return Number.isSafeInteger(length)&&length>0?{start:Math.max(0,size-length),end:size-1}:null; }
  const start=Number(match[1]), requested=match[2]?Number(match[2]):size-1;
  return Number.isSafeInteger(start)&&Number.isSafeInteger(requested)&&start>=0&&start<size&&requested>=start ? {start,end:Math.min(size-1,requested)} : null;
}
