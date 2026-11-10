import {h} from '../../js/native.js';
import {asyncRegion, button, card, detail, formatDay, heading, labelSkill, request, text, workspace} from './view.js';

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
    const scopeControl = data.classAvailable ? button(scope === 'all' ? text(ctx,'Sinfdoshlar','Classmates') : text(ctx,'Hammasi','All learners'),
      () => {scope=scope === 'all'?'class':'all';page=1;void load({background:true});}) : null;
    const podium = page===1 && data.entries.length ? h('div',{class:'study-plan-podium'},data.entries.slice(0,3).map(item =>
      h('div',{},h('strong',{},'#'+item.rank),detail(item.alias),detail(item.points)))) : null;
    content.replaceChildren(card(
      heading(text(ctx,'Ishtirok','Participation')),
      detail(data.alias ? data.alias+' · '+text(ctx,'O‘rningiz','Your position')+' #'+(data.position??'—') :
        text(ctx,'Ishtirok ixtiyoriy. Reytingda sizga tasodifiy taxallus beriladi.','Participation is optional and uses a generated alias.')),
      h('div',{class:'study-plan-actions'},toggle),notice),
      card(heading(text(ctx,'O‘quvchilar reytingi','Learner ranking')),
        h('div',{class:'study-plan-actions'},filters,scopeControl),podium,
        data.entries.length ? h('ol',{class:'study-plan-ranking',start:(page-1)*25+1},data.entries.map(item =>
          h('li',{'data-study-rank':item.rank},h('span',{},'#'+item.rank),h('span',{},item.alias+(item.mine?text(ctx,' (siz)',' (you)'):'')),h('strong',{},item.points)))) :
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
      detail(text(ctx,'Tasdiqlangan mashq uchun 5, dars uchun 3, sinov uchun 8 ball. Bir material bir marta hisoblanadi.',
        'Earn 5 points per verified practice, 3 per lesson and 8 per mock. Each material counts once.')),
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
