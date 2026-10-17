import 'server-only';
/** Deliberately narrow: the existing Worker, never a request-supplied origin. */
export const MEDIA_WORKER_ORIGIN = 'https://learnersarea-media.owneruchunla.workers.dev';
export function mediaWorkerConfiguration(): {url:string;secret:string}|null {
  const url=process.env.MEDIA_WORKER_URL, secret=process.env.MEDIA_SIGNING_SECRET;
  if (!url && !secret) return null;
  if (!url || !secret || secret.length < 32 || new URL(url).origin !== MEDIA_WORKER_ORIGIN ||
    new URL(url).pathname !== '/' || new URL(url).search || new URL(url).hash || new URL(url).username || new URL(url).password) throw Error('invalid_media_configuration');
  return {url:MEDIA_WORKER_ORIGIN,secret};
}
