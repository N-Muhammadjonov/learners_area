import {h} from '../../js/native.js';
import {api} from '../../js/api-client.js';
import {showCoinFeature} from './coin-market.js';
import {goldCoin} from '../shared/coin-reward.js';
import {privateScope} from '../../js/private-scope.js';
import {asyncRegion, button, card, detail, formatDay, heading, labelSkill, loadStyles, request, text, workspace} from './view.js';

function practiceLabel(ms) {
  const minutes = Math.floor(Math.max(0, Number(ms) || 0) / 60000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${minutes % 60} min` : `${minutes % 60} min`;
}

function initials(name) {
  const letters = String(name || '').replace(/[^A-Za-z0-9\u0400-\u04FF]/g, '');
  return (letters.slice(0, 2) || 'LA').toUpperCase();
}


function coinPolicyPanel(ctx, policy) {
  const translate = item => ctx.locale === 'uz' ? item.uz : item.en;
  const rules = (policy?.rules || []).map(item => h('li', {class: 'coin-policy-rule'},
    h('strong', {class: 'coin-policy-value'}, item.coins),
    h('span', {}, translate(item))));
  const limits = (policy?.limits || []).map(item => h('li', {}, translate(item)));
  return h('section', {class: 'coin-policy-panel', 'data-coin-policy-panel': '', 'aria-label': text(ctx,
    'Tanga yig‘ish qoidalari', 'Coin earning rules')},
    h('h2', {}, text(ctx, 'Qanday qilib tanga to‘plashim mumkin?', 'How can I earn coins?')),
    policy?.intro ? h('p', {}, translate(policy.intro)) : null,
    h('ul', {class: 'coin-policy-rules'}, rules),
    h('h3', {}, text(ctx, 'Cheklovlar', 'Limits')),
    h('ul', {class: 'coin-policy-limits'}, limits),
    policy?.example ? h('p', {class: 'coin-policy-example'}, translate(policy.example)) : null);
}

function leaderboard(ctx, content) {
  let period = 'week', scope = 'all', page = 1, panel = 'ranking', sequence = 0, latest = null;
  const cacheTtlMs = 30000;
  // Ranking periods and personal spendable coins are separate quantities.
  // All active learning roles participate in one verified coin ranking.
  const ownBalance = h('div', {class: 'coin-personal-balance', 'data-coin-personal-balance': '',
    role: 'status', 'aria-live': 'polite'});
  let walletSequence = 0;
  async function refreshWallet() {
    const ticket = ++walletSequence;
    try {
      const state = await api.request('/api/coins/wallet', {signal: ctx.signal, cache: 'no-store'});
      if (ctx.signal.aborted || walletSequence !== ticket) return;
      const balance = Math.max(0, Number(state.balance) || 0);
      const lifetime = Math.max(0, Number(state.earned) || 0);
      ownBalance.replaceChildren(
        h('strong', {class: 'inline-flex items-center gap-2'}, goldCoin(), ' ' + balance + ' ' + text(ctx, 'tanga', 'coins')),
        detail(text(ctx, 'Jami yig‘ilgan: ', 'Lifetime earned: ') + lifetime));
    } catch {
      if (!ctx.signal.aborted && walletSequence === ticket)
        ownBalance.replaceChildren(detail(text(ctx,
          'Tanga balansini yuklash amalga oshmadi.',
          'Unable to load your coin balance.')));
    }
  }
  ctx.onResume?.(() => void refreshWallet());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && content.isConnected) void refreshWallet();
  }, {signal: ctx.signal});
  window.addEventListener('focus', () => {
    if (content.isConnected) void refreshWallet();
  }, {signal: ctx.signal});
  const queryKey = () => 'view:leaderboard:' + [period, scope, page].join(':');
  async function retrieve() {
    const key = queryKey();
    const previous = privateScope.get(key);
    if (previous) return structuredClone(previous);
    const identity = privateScope.scope;
    const revision = privateScope.revision;
    const data = await request(ctx, '/leaderboard?' + new URLSearchParams({period, scope, page}));
    if (identity && identity === privateScope.scope && revision === privateScope.revision)
      privateScope.put(key, structuredClone(data), {ttl: cacheTtlMs});
    return data;
  }
  async function load({background = false} = {}) {
    const ticket = ++sequence;
    if (!background && !latest) content.replaceChildren(h('p', {role: 'status'}, ctx.dict.common.loading));
    try {
      const data = await retrieve();
      if (ctx.signal.aborted || ticket !== sequence) return;
      latest = data;
      draw(data);
    } catch {
      if (ctx.signal.aborted || ticket !== sequence) return;
      content.replaceChildren(h('div', {role: 'alert', class: 'coin-ranking-error'},
        detail(ctx.dict.errors.unknown),
        button(ctx.dict.errorPage.retry, () => void load())));
    }
  }
  const changePeriod = key => {
    if (period === key && panel === 'ranking') return;
    period = key;
    panel = 'ranking';
    page = 1;
    void load({background: true});
  };
  function draw(data) {
    const rows = (data.standings || data.entries || [])
      .filter(item => Number.isInteger(item.rank) && item.rank >= 1 && item.rank <= 20)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 20);
    const top = page === 1 ? rows.filter(item => item.rank >= 1 && item.rank <= 3) : [];
    const podiumOrder = [2, 1, 3].map(rank => top.find(item => item.rank === rank)).filter(Boolean);
    const rest = page === 1 ? rows.filter(item => item.rank > 3) : rows;
    const tab = (key, uz, en, onClick) => button(text(ctx, uz, en), onClick, {
      class: 'coin-ranking-tab' + (panel === key || key === period && panel === 'ranking' ? ' coin-ranking-tab--active' : ''),
      role: 'tab', 'aria-selected': String(panel === key || key === period && panel === 'ranking'),
      'data-coin-tab': key,
    });
    const tabs = h('div', {class: 'coin-ranking-tabs', role: 'tablist',
      'aria-label': text(ctx, 'Reyting davri va qoidalar', 'Ranking periods and rules')},
    tab('week', 'Shu hafta', 'This week', () => changePeriod('week')),
    tab('month', 'Oxirgi 30 kun', 'Last 30 days', () => changePeriod('month')),
    tab('all', 'Barcha vaqt', 'All time', () => changePeriod('all')),
    tab('help', 'Qanday qilib tanga to‘plashim mumkin?', 'How can I earn coins?', () => {
      panel = 'help';
      draw(latest || data);
    }));
    const scopeControl = data.classAvailable && panel === 'ranking'
      ? button(scope === 'all' ? text(ctx, 'Sinfdoshlar', 'Classmates') : text(ctx, 'Barcha o‘quvchilar', 'All learners'),
        () => {scope = scope === 'all' ? 'class' : 'all';page = 1;void load({background: true});},
        {class: 'coin-ranking-scope'}) : null;
    const podium = podiumOrder.length ? h('div', {class: 'coin-podium', 'data-coin-podium': ''},
      podiumOrder.map(item => h('article', {'data-place': String(item.rank)},
        item.rank === 1 ? h('span', {class: 'coin-crown', 'aria-hidden': 'true',
          'data-coin-crown': ''}, '👑') : null,
        h('div', {class: 'coin-avatar', 'aria-hidden': 'true'},
          initials(item.alias), h('span', {}, String(item.rank))),
        h('strong', {class: 'coin-podium-name'}, item.alias,
          item.mine ? h('span', {class: 'coin-mine'}, text(ctx, ' (siz)', ' (you)')) : null),
        h('div', {class: 'coin-podium-stats'},
          h('strong', {}, String(item.stars ?? item.points ?? 0), ' ⭐'),
          h('span', {}, practiceLabel(item.practiceMs)),
          h('span', {class: 'inline-flex items-center items-center gap-1'}, String(item.coins ?? 0), goldCoin())),
        h('div', {class: 'coin-plinth', 'aria-hidden': 'true'}, String(item.rank))))) : null;
    const table = rest.length ? h('div', {class: 'coin-board-scroll'},
      h('table', {class: 'coin-board'},
        h('thead', {}, h('tr', {},
          [text(ctx, 'O‘rin', 'Rank'), text(ctx, 'O‘quvchi', 'Student'),
            text(ctx, 'Yulduz', 'Stars'), text(ctx, 'Tanga', 'Coins'),
            text(ctx, 'Mashq', 'Practice')].map(label => h('th', {scope: 'col'}, label)))),
        h('tbody', {}, rest.map(item => h('tr', {'data-study-rank': item.rank},
          h('td', {class: 'coin-rank'}, String(item.rank)),
          h('td', {class: 'coin-student'}, item.alias,
            item.mine ? h('span', {class: 'coin-mine'}, text(ctx, ' (siz)', ' (you)')) : null,
            item.premium ? h('span', {class: 'coin-premium'}, 'PREMIUM') : null),
          h('td', {}, String(item.stars ?? item.points ?? 0), ' ⭐'),
          h('td', {}, String(item.coins ?? 0), ' ', goldCoin()),
          h('td', {}, practiceLabel(item.practiceMs))))))) : null;
    const rankingPanel = h('div', {class: 'coin-ranking-content', role: 'tabpanel'},
      scopeControl ? h('div', {class: 'coin-ranking-filters'}, scopeControl) : null,
      rows.length ? [podium, table] :
        h('div', {class: 'coin-ranking-empty'}, h('span', {'aria-hidden': 'true'}, '🏆'),
          h('p', {}, text(ctx, 'Bu davrda ishtirokchilar yo‘q.',
            'There are no participants in this period.'))),
      null);
    const featureModes = [
      ['ranking', 'Reyting', 'Ranking'],
      ['earn', 'Tanga yig‘ish', 'Earn coins'],
      ['gifts', 'Sovg‘alar', 'Gifts'],
      ['purchases', 'Xaridlarim', 'My purchases'],
    ];
    const featureTabs = h('nav', {
      class: 'coin-market-tabs', 'aria-label': text(ctx, 'Tanga iqtisodiyoti', 'Coin economy'),
    }, featureModes.map(([key, uz, en]) => button(text(ctx, uz, en), () => {
      if (panel === key) return;
      panel = key;
      draw(latest || data);
    }, {
      class: 'coin-market-tab' + (panel === key || key === 'ranking' && panel === 'help' ?
        ' coin-market-tab--active' : ''),
      'data-coin-feature-tab': key, 'aria-current': String(panel === key),
    })));
    const isRanking = panel === 'ranking' || panel === 'help';
    const featureHost = h('div', {class: 'coin-market-panel', 'data-coin-feature-panel': panel});
    content.replaceChildren(h('section', {class: 'coin-ranking-board', 'data-study-leaderboard': ''},
      h('h1', {class: 'coin-ranking-title'}, text(ctx, 'Tanga reytingi', 'Coin ranking')),
      h('p', {class: 'coin-ranking-top-count', 'data-leaderboard-visible-count': rows.length},
        text(ctx, 'Top 20 · ', 'Top 20 · ') + rows.length +
        text(ctx, ' ta ishtirokchi', ' participants')),
      ownBalance,
      featureTabs,
      isRanking ? tabs : null,
      isRanking ? (panel === 'help' ? coinPolicyPanel(ctx, data.policy) : rankingPanel) : featureHost));
    if (!isRanking) {
      const current = (data.standings || data.entries || []).find(item => item.mine);
      void showCoinFeature(ctx, panel, featureHost, {stars: current?.stars ?? current?.points ?? 0});
    }
  }
  void load();
  void refreshWallet();
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
  if (ranking) {
    loadStyles();
    const content = h('div', {class: 'study-plan-content coin-ranking-page',
      'data-route-usable': 'study-plan-leaderboard'});
    ctx.root.append(content);
    if (['student', 'teacher', 'admin', 'owner'].includes(ctx.session?.user?.role)) leaderboard(ctx, content);
    return;
  }
  const {content} = workspace(ctx, title, text(ctx,
    'Tasdiqlangan o‘quv faoliyati asosida.', 'Based on verified learning activity.'));
  if (['student', 'owner'].includes(ctx.session?.user?.role)) rewards(ctx, content);
}
