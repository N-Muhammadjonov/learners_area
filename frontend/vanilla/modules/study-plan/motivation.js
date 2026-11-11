import {h} from '../../js/native.js';
import {asyncRegion, button, card, detail, formatDay, heading, labelSkill, request, text, workspace} from './view.js';

function practiceLabel(ms) {
  const minutes = Math.floor(Math.max(0, Number(ms) || 0) / 60000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${minutes % 60} min` : `${minutes % 60} min`;
}

function initials(name) {
  const letters = String(name || '').replace(/[^A-Za-z0-9\u0400-\u04FF]/g, '');
  return (letters.slice(0, 2) || 'LA').toUpperCase();
}

function helpDialog(ctx, policy, opener) {
  const close = () => {dialog.close();opener.focus();};
  const rules = (policy?.rules || []).map(rule => h('li', {}, h('strong', {}, rule.coins + ' · '), ctx.locale === 'uz' ? rule.uz : rule.en));
  const limits = (policy?.limits || []).map(rule => h('li', {}, ctx.locale === 'uz' ? rule.uz : rule.en));
  const dialog = h('dialog', {class: 'coin-help', 'aria-labelledby': 'coin-help-title'},
    h('h2', {id: 'coin-help-title'}, text(ctx, 'Qanday qilib tanga to‘plashim mumkin?', 'How can I earn coins?')),
    h('p', {}, policy?.intro ? (ctx.locale === 'uz' ? policy.intro.uz : policy.intro.en) : ''),
    h('ul', {}, rules),
    h('h3', {}, text(ctx, 'Cheklovlar', 'Limits')),
    h('ul', {}, limits),
    h('p', {}, policy?.example ? (ctx.locale === 'uz' ? policy.example.uz : policy.example.en) : ''),
    h('button', {type: 'button', class: 'btn-primary', onClick: close}, text(ctx, 'Yopish', 'Close')));
  dialog.addEventListener('cancel', event => {event.preventDefault();close();});
  dialog.addEventListener('close', () => opener.focus());
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector('button').focus();
}

function leaderboard(ctx, content) {
  let period = 'week', scope = 'all', page = 1;
  const load = asyncRegion(ctx, content, () => request(ctx,
    '/leaderboard?' + new URLSearchParams({period,scope,page})), draw);
  function draw(data) {
    const notice = h('p',{role:'status',class:'text-sm'});
    const toggle = button(data.alias ? text(ctx, 'Reytingdan chiqish', 'Opt out') : text(ctx, 'Reytingga qo‘shilish', 'Opt in'),
      async event => {
        const control = event.currentTarget;
        control.disabled = true;
        try {
          await request(ctx,'/leaderboard/participation',{method:'PUT',body:{enabled:!data.alias}});
          if (!ctx.signal.aborted) void load({background:true});
        } catch (error) {
          if (!ctx.signal.aborted) notice.textContent = error.status === 409 ?
            text(ctx,'Avval o‘quv rejasini sozlang.','Set up your study plan first.') : ctx.dict.errors.unknown;
        } finally {control.disabled = false;}
      });
    const filters = [
      ['week','Shu hafta','This week'], ['month','Oxirgi 30 kun','Last 30 days'], ['all','Barcha vaqt','All time'],
    ].map(([key,uz,en]) => button(text(ctx,uz,en), () => {period=key;page=1;void load({background:true});},
      {class:period === key ? 'btn-primary':'btn-secondary','aria-pressed':String(period===key)}));
    const help = button(text(ctx, 'Qanday qilib tanga to‘plashim mumkin?', 'How can I earn coins?'), event => helpDialog(ctx, data.policy, event.currentTarget),
      {class:'btn-secondary', 'data-coin-help':''});
    const scopeControl = data.classAvailable ? button(scope === 'all' ? text(ctx,'Sinfdoshlar','Classmates') : text(ctx,'Hammasi','All learners'),
      () => {scope=scope === 'all'?'class':'all';page=1;void load({background:true});}) : null;
    const rows = (data.standings || data.entries || []).slice(0, 20);
    const top = rows.filter(item => item.rank <= 3);
    const ordered = [top.find(item => item.rank === 2), top.find(item => item.rank === 1), top.find(item => item.rank === 3)].filter(Boolean);
    const podium = page === 1 && ordered.length ? h('div', {class:'coin-podium'}, ordered.map(item =>
      h('article', {'data-place': String(item.rank)},
        h('div', {class:'coin-avatar', 'aria-hidden':'true'}, initials(item.alias), h('span', {}, String(item.rank))),
        h('strong', {}, item.alias),
        h('p', {}, String(item.stars ?? item.points ?? 0) + ' ★'),
        h('p', {}, String(item.coins ?? 0) + ' ●'),
        h('p', {}, practiceLabel(item.practiceMs))))) : null;
    const live = data.practising?.length ? h('p', {class:'coin-live'},
      text(ctx, data.practising.length + ' o‘quvchi hozir mashq qilmoqda', data.practising.length + ' students practising now'),
      ' · ', data.practising.slice(0, 3).join(' · ')) : null;
    const table = h('table', {class:'coin-board'},
      h('thead', {}, h('tr', {},
        [text(ctx,'O‘rin','Rank'), text(ctx,'O‘quvchi','Student'), text(ctx,'Yulduz','Stars'), text(ctx,'Tanga','Coins'), text(ctx,'Mashq','Practice')].map(label => h('th', {scope:'col'}, label)))),
      h('tbody', {}, rows.map(item => h('tr', {'data-study-rank': item.rank},
        h('td', {}, String(item.rank)),
        h('td', {}, item.alias + (item.mine ? text(ctx,' (siz)',' (you)') : ''), item.premium ? h('span', {class:'badge'}, 'PREMIUM') : null),
        h('td', {}, String(item.stars ?? item.points ?? 0)),
        h('td', {}, String(item.coins ?? 0)),
        h('td', {}, practiceLabel(item.practiceMs))))));
    content.replaceChildren(card(
      heading(text(ctx,'Ishtirok','Participation')),
      detail(data.alias ? data.alias+' · '+text(ctx,'O‘rningiz','Your position')+' #'+(data.position??'—') :
        text(ctx,'Ishtirok ixtiyoriy. Reytingda sizga tasodifiy taxallus beriladi.','Participation is optional and uses a generated alias.')),
      h('div',{class:'study-plan-actions'},toggle),notice),
      card(heading(text(ctx,'O‘quvchilar reytingi','Learner ranking')),
        live,
        h('div',{class:'study-plan-actions'},filters,scopeControl,help),
        rows.length ? h('div', {}, podium, table) :
          detail(text(ctx,'Bu davrda ishtirokchilar yo‘q.','There are no participants in this view.')),
        h('div',{class:'study-plan-actions'},
          page>1?button(text(ctx,'Oldingi','Previous'),()=>{page--;void load({background:true});}):null,
          data.hasMore?button(text(ctx,'Keyingi','Next'),()=>{page++;void load({background:true});}):null)));
  }
  void load();
}

function rewards(ctx, content) {
  function draw(data) {
    const owned = new Set(data.purchases.map(row => row.item_key));
    const notice = h('p',{role:'status',class:'text-sm'});
    const label = item => ctx.locale==='uz' ? item.labelUz : item.label;
    const itemName = key => {
      const item = data.items.find(row => row.key===key);
      return item ? label(item) : key;
    };
    const market = data.items.map(item => {
      const confirm = h('details',{},h('summary',{},text(ctx,'Almashtirish','Redeem')),
        detail(item.cost+' '+text(ctx,'ball yechiladi.','points will be used.')),
        button(text(ctx,'Tasdiqlash','Confirm'),async event => {
          const control = event.currentTarget;
          control.disabled = true;
          try {
            const next = await request(ctx,'/rewards/'+item.key,{method:'PUT'});
            if (!ctx.signal.aborted) draw(next);
          } catch (error) {
            if (!ctx.signal.aborted) notice.textContent = error.status === 409 ?
              text(ctx,'Almashtirish uchun ball yetarli emas.','You do not have enough points to redeem this.') : ctx.dict.errors.unknown;
          } finally {control.disabled = false;}
        }));
      return card(heading(label(item)),detail(item.cost+' '+text(ctx,'ball','points')),
        owned.has(item.key) ? detail(text(ctx,'Olingan','Owned')) :
          data.balance>=item.cost ? confirm : detail(text(ctx,'Ball yetarli emas','Insufficient points')));
    });
    content.replaceChildren(card(heading(text(ctx,'Ball hamyoni','Points wallet')),
      h('strong',{'data-study-balance':''},data.balance+' '+text(ctx,'ball','points')),
      data.coins ? h('p', {'data-coin-balance':''}, data.coins.balance+' '+text(ctx,'tanga','coins')+' · '+text(ctx,'daraja','level')+' '+data.coins.level) : null,
      detail(text(ctx,'Eski ballar do‘kon uchun saqlanadi. Yangi tanga faqat server tasdiqlagan mashq uchun yoziladi.',
        'Legacy points stay available for the shop. New coins are written only after the server accepts an exercise.')),
      detail(text(ctx,'SRS takrori 2 ball (kuniga 5 tagacha), kunlik reja bonusi 4 ball.',
        'Earn 2 points per SRS review (up to 5 per day) and a 4-point daily plan bonus.')),
      owned.size ? h('div',{class:'study-plan-cosmetics','data-frame':owned.has('blue-frame'),'data-theme':owned.has('violet-theme')},
        h('strong',{},text(ctx,'Shaxsiy bezak','Your study card')),
        owned.has('focus-badge') ? h('p',{},itemName('focus-badge')) : null) : null),
      card(heading(text(ctx,'Mukofotlar do‘koni','Reward marketplace')),
        detail(text(ctx,'Bezak olinganidan keyin hisobingizda qoladi. Almashtirish yakuniy.',
          'Cosmetics stay on your account after redemption. Redemptions are final.')),
        h('div',{class:'study-plan-grid'},market),notice),
      h('div',{class:'study-plan-grid'},
        card(heading(text(ctx,'Ball tarixi','Earning history')), data.earning.length ?
          data.earning.map(row=>detail(formatDay(ctx,row.earned_at.slice(0,10))+' · '+labelSkill(row.kind)+' · +'+row.points)) :
          detail(text(ctx,'Ball tarixi bo‘sh.','No points earned yet.'))),
        card(heading(text(ctx,'Almashtirishlar','Purchase history')), data.purchases.length ?
          data.purchases.map(row=>detail(formatDay(ctx,row.purchased_at.slice(0,10))+' · '+itemName(row.item_key)+' · '+row.points)) :
          detail(text(ctx,'Almashtirishlar hali yo‘q.','No redemptions yet.')))));
  }
  void asyncRegion(ctx, content, () => request(ctx,'/rewards'), draw)();
}

export function mount(ctx) {
  const ranking = ctx.url.pathname.endsWith('/leaderboard');
  const title = ranking ? text(ctx,'Reyting','Leaderboard') : text(ctx,'Mukofotlar','Rewards');
  const {content} = workspace(ctx,title,text(ctx,'Tasdiqlangan o‘quv faoliyati asosida.','Based on verified learning activity.'));
  if (ctx.session?.user?.role !== 'student') return;
  if (ranking) leaderboard(ctx,content);
  else rewards(ctx,content);
}
