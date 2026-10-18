import type {CourseStatus} from '@/lib/listening/course-progress';

type Checkpoint = {values:Record<string,string>;course?:CourseStatus|null;recovered:boolean};

/** A conflict may restore the authoritative checkpoint; outages must retain the outbox. */
export async function readListeningCheckpoint(response: Response): Promise<Checkpoint> {
  const data = await response.json();
  const recovered = response.status === 409 && data?.error === 'stale_checkpoint';
  const values = data?.values;
  if ((!response.ok && !recovered) || !values || typeof values !== 'object' || Array.isArray(values) ||
      !Object.values(values).every(value => typeof value === 'string') || JSON.stringify(values).length > 100000) {
    throw Error('checkpoint_unavailable');
  }
  return {values,course:data.course,recovered};
}

/** Keep every conflicting draft before removing its retry entry. Storage failure is fatal. */
export function archiveListeningOutbox(storage: Storage, stateKey: string, sent: string): string {
  const queued = storage.getItem(stateKey+':pending');
  const copies = queued && queued !== sent ? [sent,queued] : [sent];
  const backup = JSON.stringify({capturedAt:new Date().toISOString(),drafts:copies.map(value=>JSON.parse(value))},null,2);
  storage.setItem(stateKey+':conflict:'+crypto.randomUUID(),backup);
  if (storage.getItem(stateKey+':pending') === queued) storage.removeItem(stateKey+':pending');
  return backup;
}

/** Archived work remains downloadable after the page is reopened. */
export function archivedListeningOutboxes(storage: Storage, stateKey: string): string|null {
  const backups: unknown[] = [];
  for (let i=0;i<storage.length;i++) {
    const key=storage.key(i);
    if (!key?.startsWith(stateKey+':conflict:')) continue;
    try {const value=JSON.parse(storage.getItem(key)??'null');if(Array.isArray(value?.drafts))backups.push(value);} catch {}
  }
  return backups.length ? JSON.stringify({backups},null,2) : null;
}
