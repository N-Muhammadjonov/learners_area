import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {BACKGROUND_ASSETS} from '../src/lib/ui/background-assets';

test('approved wallpaper bytes are content-addressed and paired with an inline first-paint image', () => {
  const css = readFileSync('src/app/globals.css', 'utf8');
  for (const asset of BACKGROUND_ASSETS) {
    const bytes = readFileSync(`public${asset.href}`);
    assert.ok(asset.href.includes(createHash('sha256').update(bytes).digest('hex').slice(0,12)));
    assert.ok(bytes.length < 50_000);
    assert.ok(asset.previewBytes < 1200);
    assert.ok(css.includes(asset.href));
  }
  for (const match of css.matchAll(/data:image\/webp;base64,([A-Za-z0-9+/=]+)/g)) {
    assert.equal(Buffer.from(match[1]!, "base64").subarray(0,4).toString(), "RIFF");
  }
  assert.ok(css.includes('background-image: var(--la-day-wallpaper), var(--la-day-wallpaper-preview)'));
});
test('preload is server-selected and the mobile/tablet Welcome page is untouched', () => {
  const root=readFileSync('src/app/layout.tsx','utf8');
  assert.match(root,/asset.theme === theme/);
  assert.match(root,/rel="preload" as="image"/);
  assert.match(root,/media=\{asset.media\} fetchPriority="high"/);
  const intro=readFileSync('src/components/brand/DesktopIntro.tsx','utf8');
  assert.ok(intro.includes('(min-width: 1024px) and (hover: hover) and (pointer: fine)'));
  assert.ok(intro.includes('data-touch-welcome>{children}'));
});
