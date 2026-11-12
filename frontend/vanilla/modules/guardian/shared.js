import {h} from '../../js/native.js';

export function loadStyles() {
  if (!document.querySelector('[data-guardian-css]')) {
    document.head.append(h('link', {rel: 'stylesheet', href: '/modules/guardian/style.css', 'data-guardian-css': ''}));
  }
}

export const tr = (ctx, uz, en) => (ctx.locale === 'uz' ? uz : en);

/** Read-only JSON fetch. Failures carry the HTTP status so pages can show a precise, honest state. */
export async function api(path, {signal, method = 'GET', body} = {}) {
  const response = await fetch(path, {
    method, signal, credentials: 'same-origin', cache: 'no-store',
    headers: body ? {'Content-Type': 'application/json'} : undefined, body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await response.json(); } catch { /* non-JSON error body */ }
  if (!response.ok) throw Object.assign(new Error((data && data.error) || 'request_failed'), {status: response.status, data});
  return data;
}

export function failureText(ctx, error) {
  const code = error?.message;
  if (code === 'channel_required') return tr(ctx, 'Davom etish uchun ota-onalar kanaliga qo‘shiling va qayta urining.', 'Join the parents’ channel and try again.');
  if (code === 'membership_unavailable') return tr(ctx, 'Kanal a’zoligini hozir tekshirib bo‘lmadi. Birozdan so‘ng qayta urinib ko‘ring.', 'Channel membership could not be checked now. Please retry shortly.');
  if (error?.status === 403) return tr(ctx, 'Bu ma’lumotni ko‘rishga ruxsat yo‘q.', 'You do not have access to this information.');
  return ctx.dict?.errors?.unknown || tr(ctx, 'Xatolik yuz berdi.', 'Something went wrong.');
}

export function marker(ctx) {
  return h('span', {class: 'pc-marker', 'data-guardian-readonly': ''}, tr(ctx, 'Ota-ona ko‘rishi · Faqat o‘qish', 'Parent view · Read-only'));
}

/** Child picker. Contains ONLY approved links returned by the server; the chosen id is re-verified server-side on every read. */
export async function loadChildren(ctx) {
  const data = await api('/api/guardian/children', {signal: ctx.signal});
  const children = data.children || [];
  const wanted = ctx.url.searchParams.get('child');
  const selected = children.find(c => c.studentId === wanted) || children[0] || null;
  return {children, selected};
}

export function childPicker(ctx, children, selected, onPick) {
  if (children.length < 2) return null;
  return h('div', {class: 'pc-chips', role: 'group', 'aria-label': tr(ctx, 'Farzandni tanlang', 'Choose a child')},
    children.map(c => h('button', {type: 'button', class: 'pc-chip', 'aria-pressed': String(c.studentId === selected.studentId),
      onClick: () => onPick(c)}, c.name)));
}

export function emptyState(ctx) {
  return h('div', {class: 'pc-card', role: 'status'}, tr(ctx,
    'Hozircha tasdiqlangan farzand yo‘q. Talaba Telegram botda ulanishni tasdiqlashi kerak.',
    'No approved child yet. The student must approve the connection in the Telegram bot.'));
}
