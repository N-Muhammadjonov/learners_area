import {h} from '../../js/native.js';
import {dictionary, readPreferences} from '../../js/preferences.js';
import {asyncRegion, button, card, dayTotals, detail, formatDay, loadStyles, request, text} from './view.js';

function preview(ctx, days) {
  return h('ul', {class:'study-plan-tasks'}, days.map(day =>
    h('li', {}, formatDay(ctx, day.date) + ' · ' + day.completed + '/' + day.planned + ' · ' + day.minutes + ' ' + text(ctx, 'daq.', 'min'))));
}

export function shareControls(ctx, data) {
  const days = data.days.map(day => ({date:day.date,...dayTotals(day)}));
  const status = h('p', {role:'status', class:'text-sm'});
  const summaryHost = h('div',{},preview(ctx,days));
  const manage = h('div', {class:'flex flex-col gap-2'});
  const url = h('textarea', {class:'input min-w-0 w-full', rows:2, readOnly:true, hidden:true, 'aria-label':text(ctx, 'Ulashish havolasi', 'Share link')});
  const refresh = asyncRegion(ctx, manage, () => request(ctx,'/share'), data => {
    manage.replaceChildren(...data.links.map(item => h('div',{class:'study-plan-actions'},
      detail(text(ctx, 'Amal qilish muddati', 'Expires') + ' · ' + formatDay(ctx,item.expires_at.slice(0,10))),
      button(text(ctx, 'Bekor qilish', 'Revoke'), async event => {
        const control = event.currentTarget;
        control.disabled = true;
        try {
          await request(ctx,'/share/'+item.id,{method:'DELETE'});
          if (!ctx.signal.aborted) {
            url.hidden = true;
            url.value = '';
            status.textContent = text(ctx, 'Havola bekor qilindi.', 'Link revoked.');
            void refresh();
          }
        } catch {status.textContent = ctx.dict.errors.unknown;}
        finally {control.disabled = false;}
      }))));
  });
  const copy = button(text(ctx, 'Xulosani nusxalash', 'Copy summary'), async () => {
    const summary = preview(ctx,days);
    const lines = [...summary.children].map(row => row.textContent);
    const result = [text(ctx,'Haftalik o‘quv reja','Weekly study plan'),...lines].join('\n');
    try {await navigator.clipboard.writeText(result);status.textContent = text(ctx, 'Xulosa nusxalandi.', 'Summary copied.');}
    catch {url.hidden = false; url.value = result;url.select();}
  });
  const create = button(text(ctx, '7 kunlik havola yaratish', 'Create a 7-day link'), async event => {
    const control = event.currentTarget;
    control.disabled = true;
    try {
      const link = await request(ctx,'/share',{method:'POST',body:{consent:true}});
      if (ctx.signal.aborted) return;
      summaryHost.replaceChildren(preview(ctx,link.snapshot.days));
      url.hidden = false;
      url.value = new URL(link.url,location.origin).href;
      url.focus();
      url.select();
      status.textContent = text(ctx, 'Havola tayyor.', 'Link created.');
      void refresh();
    } catch {if (!ctx.signal.aborted) status.textContent = ctx.dict.errors.unknown;}
    finally {control.disabled = false;}
  });
  const details = h('details', {}, h('summary', {}, text(ctx, 'Haftalik rejani ulashish', 'Share weekly plan')),
    h('div',{class:'flex flex-col gap-3'},
      detail(text(ctx, 'Havolani olgan odam sanalar, vazifa soni va rejalangan daqiqalarni ko‘radi.',
        'Anyone with the link can see dates, task counts and planned minutes.')),
      summaryHost,h('div',{class:'study-plan-actions'},copy,create),url,status,manage));
  details.addEventListener('toggle', () => {if (details.open) void refresh();}, {signal:ctx.signal});
  return card(details);
}

export async function mount(context) {
  const locale = readPreferences().locale;
  const dict = await dictionary(locale);
  if (context.signal.aborted) return;
  const ctx = {...context, locale, dict};
  loadStyles();
  const page = h('main',{class:'study-plan-share','data-route-usable':'shared-study-plan'});
  const host = h('div',{class:'flex flex-col gap-2'});
  page.append(card(h('h1',{class:'font-display text-xl'},text(ctx, 'Haftalik o‘quv reja', 'Weekly study plan')), host));
  ctx.root.append(page);
  const token = ctx.url.hash.slice(1);
  if (!/^[\w-]{43}$/.test(token)) {
    host.append(detail(text(ctx,'Havola topilmadi.','Link not found.')));
    return;
  }
  host.textContent = ctx.dict.common.loading;
  void request(ctx,'/shared',{method:'POST',body:{token}}).then(data => {
    if (!ctx.signal.aborted) host.replaceChildren(preview(ctx,data.days));
  },error => {
    if (!ctx.signal.aborted) host.replaceChildren(detail(error.status === 404 ?
      text(ctx,'Havola muddati o‘tgan yoki bekor qilingan.','This link has expired or was revoked.') : ctx.dict.errors.unknown));
  });
}
