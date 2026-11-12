import {h} from '../../js/native.js';
import {api, loadStyles, tr, failureText} from './shared.js';

const STATUS = {
  linked: ['Ulangan', 'Linked', 'good'], awaiting_student: ['Talaba tasdig‘i kutilmoqda', 'Waiting for approval', 'warn'],
  awaiting_guardian: ['Taklif kutilmoqda', 'Invitation pending', 'warn'], revoked: ['Uzilgan', 'Revoked', 'bad'], rejected: ['Rad etilgan', 'Rejected', 'bad'],
};
const REL = {mother: ['Onasi', 'Mother'], father: ['Otasi', 'Father'], older_brother: ['Akasi', 'Older brother'], younger_brother: ['Ukasi', 'Younger brother'],
  older_sister: ['Opasi', 'Older sister'], younger_sister: ['Singlisi', 'Younger sister'], guardian: ['Vasiy', 'Guardian'], other: ['Boshqa', 'Other']};

/** Owner > Management > Ota-onalar. Server-side search/pagination. Nothing is sent without Preview -> explicit confirm. */
export async function mount(ctx) {
  loadStyles();
  const {root, signal, dict} = ctx;
  const T = (uz, en) => tr(ctx, uz, en), L = ctx.locale === 'uz' ? 0 : 1;
  const S = {page: 1, q: '', status: 'live', relationship: '', channel: '', selected: new Set(), templates: [], body: '', templateKey: null,
    key: null, preview: null, busy: false, message: null, error: null, data: null, detail: null};
  const newKey = () => { S.key = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/[^A-Za-z0-9_-]/g, '') .padEnd(16, '0'); };
  newKey();
  const host = h('div', {class: 'pc-page', 'data-route-usable': 'management-guardians'});
  root.append(host);
  let timer = 0, ticket = 0;

  async function load() {
    const mine = ++ticket;
    const params = new URLSearchParams({page: S.page, status: S.status});
    for (const k of ['q', 'relationship', 'channel']) if (S[k]) params.set(k, S[k]);
    try {
      const data = await api('/api/staff/guardians?' + params, {signal});
      if (signal.aborted || mine !== ticket) return;
      S.data = data; S.error = null;
    } catch (error) { if (signal.aborted || mine !== ticket) return; S.error = failureText(ctx, error); }
    paint();
  }
  const fieldChange = (key, value) => { S[key] = value; S.page = 1; void load(); };
  const resetPreview = () => { S.preview = null; newKey(); };

  const select = (key, options, label) => h('select', {'aria-label': label, value: S[key], onChange: e => fieldChange(key, e.target.value)},
    options.map(([v, text]) => h('option', {value: v, selected: S[key] === v}, text)));

  async function runPreview() {
    S.busy = true; S.error = null; paint();
    try { S.preview = await api('/api/staff/guardian-messages/preview', {signal, method: 'POST', body: {body: S.body, templateKey: S.templateKey, linkIds: [...S.selected]}}); }
    catch (error) { S.error = error.message === 'unknown_placeholder' ? T('Faqat {student_name} va {guardian_relation} ishlatish mumkin.', 'Only {student_name} and {guardian_relation} are allowed.') : failureText(ctx, error); }
    S.busy = false; paint();
  }
  async function runSend() {
    S.busy = true; S.error = null; paint();
    try {
      const out = await api('/api/staff/guardian-messages/send', {signal, method: 'POST',
        body: {body: S.body, templateKey: S.templateKey, linkIds: [...S.selected], confirm: true, idempotencyKey: S.key}});
      S.message = T(`${out.queued} ta xabar navbatga qo‘yildi. Haqiqiy holat yuborilgach ko‘rinadi.`, `${out.queued} message(s) queued. Real delivery status appears after sending.`);
      S.selected.clear(); S.body = ''; S.templateKey = null; resetPreview();
    } catch (error) { S.error = error.message === 'no_eligible_recipients' ? T('Mos qabul qiluvchi topilmadi.', 'No eligible recipient found.') : failureText(ctx, error); }
    S.busy = false; paint(); void load();
  }
  async function openDetail(id) {
    try { S.detail = await api('/api/staff/guardians/' + encodeURIComponent(id), {signal}); } catch (error) { S.error = failureText(ctx, error); }
    paint();
  }

  function metrics() {
    const m = S.data?.metrics;
    const cell = (v, uz, en) => h('div', {class: 'pc-card pc-metric'}, h('b', {}, m ? String(v) : '…'), h('span', {}, T(uz, en)));
    return h('div', {class: 'pc-metrics'}, cell(m?.linked, 'Ulangan ota-onalar', 'Linked guardians'), cell(m?.awaitingApproval, 'Kutilayotgan tasdiqlar', 'Waiting for approval'),
      cell(m?.channelRequired, 'Kanalga qo‘shilishi kerak', 'Parent channel required'), cell(m?.manualMessagesSent, 'Qo‘lda yuborilgan xabarlar', 'Manually sent messages'));
  }
  function table() {
    const d = S.data;
    if (!d) return h('p', {role: 'status'}, dict.common.loading);
    if (!d.items.length) return h('p', {class: 'pc-muted', role: 'status'}, T('Hech narsa topilmadi.', 'Nothing found.'));
    const pages = Math.max(1, Math.ceil(d.total / d.pageSize));
    return h('div', {},
      h('div', {class: 'pc-scroll'}, h('table', {class: 'pc-table'},
        h('thead', {}, h('tr', {}, ['', T('Talaba', 'Student'), T('Kim?', 'Who?'), 'Telegram', T('Ulanish', 'Link'), T('Ota-onalar kanali', 'Parent channel'), ''].map(x => h('th', {scope: 'col'}, x)))),
        h('tbody', {}, d.items.map(r => {
          const st = STATUS[r.status];
          return h('tr', {},
            h('td', {}, r.status === 'linked' ? h('input', {type: 'checkbox', 'aria-label': T('Tanlash', 'Select') + ' ' + r.studentName, checked: S.selected.has(r.linkId),
              onChange: e => { e.target.checked ? S.selected.add(r.linkId) : S.selected.delete(r.linkId); resetPreview(); paint(); }}) : null),
            h('td', {}, r.studentName), h('td', {}, `${r.guardianName || '—'} · ${r.relationship ? REL[r.relationship][L] : '—'}`), h('td', {}, r.telegram),
            h('td', {}, h('span', {class: 'pc-pill', 'data-tone': st[2]}, st[L])),
            h('td', {}, h('span', {class: 'pc-pill', 'data-tone': r.channelJoined ? 'good' : 'warn'}, r.channelJoined ? T('Qo‘shilgan', 'Joined') : T('Kerak', 'Required'))),
            h('td', {}, h('button', {type: 'button', class: 'btn-ghost', onClick: () => void openDetail(r.linkId)}, T('Ko‘rish', 'View'))));
        })))),
      h('div', {class: 'pc-toolbar', style: {marginTop: '.75rem'}},
        h('button', {type: 'button', class: 'btn-secondary', disabled: d.page <= 1, onClick: () => { S.page--; void load(); }}, '←'),
        h('span', {class: 'pc-muted'}, `${d.page} / ${pages} · ${d.total}`),
        h('button', {type: 'button', class: 'btn-secondary', disabled: d.page >= pages, onClick: () => { S.page++; void load(); }}, '→')));
  }
  function detail() {
    if (!S.detail) return null;
    const l = S.detail.link;
    return h('section', {class: 'pc-card', 'aria-label': T('Batafsil', 'Details')},
      h('div', {class: 'pc-toolbar'}, h('h2', {class: 'card-title'}, `${l.studentName} ← ${l.guardianName || '—'}`),
        h('button', {type: 'button', class: 'btn-ghost', onClick: () => { S.detail = null; paint(); }}, dict.common.cancel ?? '×')),
      h('p', {class: 'pc-muted'}, [`${STATUS[l.status][L]}`, l.relationship ? REL[l.relationship][L] : null, l.telegramUsername ? '@' + l.telegramUsername : 'ID ' + l.telegramUserId, l.phone].filter(Boolean).join(' · ')),
      h('h3', {class: 'card-title'}, T('Qo‘lda yuborilgan xabarlar tarixi', 'Manual message history')),
      S.detail.messages.length ? h('ul', {}, S.detail.messages.map(m => h('li', {class: 'pc-muted'},
        `${m.createdAt?.slice(0, 16).replace('T', ' ')} · ${m.template || 'custom'} · ${m.status}${m.error ? ' (' + m.error + ')' : ''}`))) : h('p', {class: 'pc-muted'}, T('Hali xabar yo‘q.', 'No messages yet.')));
  }
  function composer() {
    const count = S.selected.size;
    const templates = h('div', {class: 'pc-chips'}, S.templates.map(tpl => h('button', {type: 'button', class: 'pc-chip', 'aria-pressed': String(S.templateKey === tpl.key),
      onClick: () => { S.templateKey = tpl.key; S.body = tpl.body[ctx.locale === 'uz' ? 'uz' : 'en']; resetPreview(); paint(); }}, tpl.title[ctx.locale === 'uz' ? 'uz' : 'en'])));
    const area = h('textarea', {class: 'pc-textarea', maxlength: '1500', 'aria-label': T('Xabar matni', 'Message text'), value: S.body,
      onInput: e => { S.body = e.target.value; if (S.preview) { resetPreview(); host.querySelector('[data-pc-preview]')?.remove(); } }});
    const p = S.preview;
    return h('section', {class: 'pc-card', 'aria-label': T('Xabar yozish', 'Write a message')},
      h('h2', {class: 'card-title'}, T('✉ Xabar yozish', '✉ Write a message')),
      h('p', {class: 'pc-note'}, T('Hech narsa avtomatik jo‘natilmaydi. Tayyor matnni tanlang yoki o‘zingiz yozing, ko‘rib chiqing va tasdiqlang.', 'Nothing is sent automatically. Pick a text or write your own, preview it, then confirm.')),
      templates, area,
      h('p', {class: 'pc-muted'}, T(`Tanlangan qabul qiluvchilar: ${count}. Faqat “Ulangan” qatorlarni tanlash mumkin.`, `Selected recipients: ${count}. Only “Linked” rows can be selected.`)),
      h('div', {class: 'pc-actions'}, h('button', {type: 'button', class: 'btn-secondary', disabled: S.busy || !count || !S.body.trim(), onClick: () => void runPreview()}, T('Ko‘rib chiqish', 'Preview'))),
      p ? h('div', {class: 'pc-card', role: 'status', 'data-pc-preview': ''},
        h('b', {}, T(`Aniq ${p.count} ta qabul qiluvchi`, `Exactly ${p.count} recipient(s)`)),
        p.skipped.length ? h('p', {class: 'pc-muted'}, T(`${p.skipped.length} ta qator mos emas va o‘tkazib yuboriladi.`, `${p.skipped.length} row(s) are not eligible and will be skipped.`)) : null,
        h('ul', {}, p.sample.slice(0, 3).map(x => h('li', {class: 'pc-muted'}, `${x.studentName}: ${x.text.split('\n')[0]}…`))),
        h('button', {type: 'button', class: 'btn-primary', disabled: S.busy || p.count < 1, 'data-interaction-type': 'destructive', onClick: () => void runSend()},
          T(`Tasdiqlayman va ${p.count} ta xabarni yuboraman`, `I confirm — send ${p.count} message(s)`))) : null);
  }
  function paint() {
    host.replaceChildren(
      h('div', {class: 'pc-toolbar'}, h('div', {}, h('h1', {class: 'font-display text-2xl text-ink-900'}, T('Ota-onalar nazorati', 'Guardians')),
        h('p', {class: 'pc-muted'}, T('Talaba–ota-ona bog‘lanishlari va qo‘lda yuboriladigan xabarlar', 'Student–guardian links and manually sent messages'))),
        h('button', {type: 'button', class: 'btn-secondary', onClick: () => void load()}, '↻ ' + T('Yangilash', 'Refresh'))),
      metrics(),
      h('div', {class: 'pc-card'},
        h('div', {class: 'pc-toolbar'},
          h('input', {type: 'search', maxlength: '80', placeholder: T('Talaba, ota-ona yoki Telegram…', 'Student, guardian or Telegram…'), 'aria-label': T('Qidirish', 'Search'), value: S.q,
            onInput: e => { clearTimeout(timer); const v = e.target.value; timer = setTimeout(() => fieldChange('q', v.trim()), 350); }}),
          select('status', [['live', T('Faol', 'Active')], ['all', T('Hammasi', 'All')], ...Object.entries(STATUS).map(([k, v]) => [k, v[L]])], T('Holat', 'Status')),
          select('relationship', [['', T('Hamma qarindoshlar', 'Any relationship')], ...Object.entries(REL).map(([k, v]) => [k, v[L]])], T('Qarindoshlik', 'Relationship')),
          select('channel', [['', T('Kanal: hammasi', 'Channel: any')], ['joined', T('Qo‘shilgan', 'Joined')], ['required', T('Kerak', 'Required')]], T('Kanal', 'Channel'))),
        S.error ? h('p', {role: 'alert', class: 'pc-note', style: {marginTop: '.5rem'}}, S.error) : null,
        S.message ? h('p', {role: 'status', class: 'pc-note', style: {marginTop: '.5rem'}}, S.message) : null,
        h('div', {style: {marginTop: '.75rem'}}, table())),
      detail(), composer());
  }
  paint();
  try { S.templates = (await api('/api/staff/guardian-message-templates', {signal})).templates; } catch { /* composer still works with custom text */ }
  if (!signal.aborted) { paint(); void load(); }
}
