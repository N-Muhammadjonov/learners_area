import 'server-only';
import { adaptOriginalTestOne } from './original-test-one-hooks';
import { readFile } from 'node:fs/promises';

export const ORIGINAL_TEST_ONE_ID = 'e44e3d4b-3af6-41a9-b465-7d4bc21e1019';
export const ORIGINAL_TEST_ONE_STORAGE = 'la_listening_test_1_v2';
/** Explicit identity: no title matching and no DB re-import or revision change. */
export function usesOriginalTestOne(id: string, sourceId: string) {
  return id === ORIGINAL_TEST_ONE_ID && sourceId === 'listening-test-1';
}
export async function originalTestOneRuntime() {
  const html = await readFile(process.cwd() + '/content/listening/academic/test-01/source.html', 'utf8');
  return { entryPath: 'source.html', files: { 'source.html': adaptOriginalTestOne(html) } };
}
