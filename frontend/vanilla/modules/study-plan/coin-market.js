import {h} from '../../js/native.js';
import {api} from '../../js/api-client.js';
import {button, card, detail, heading, text} from './view.js';

const formatNumber = value => Number(value || 0).toLocaleString('en-US');
const localized = (ctx, uz, en) => text(ctx, uz, en);
const loading = ctx => h('p', {role: 'status'}, ctx.dict.common.loading);
const errorNotice = (ctx, message) => h('p', {role: 'alert', class: 'coin-market-error'}, message || ctx.dict.errors.unknown);
const titleFor = (ctx, item) => ctx.locale === 'uz' ? item.titleUz : item.titleEn;
const descriptionFor = (ctx, item) => ctx.locale === 'uz' ? item.descriptionUz : item.descriptionEn;

function balanceCards(ctx, wallet, stars = 0) {
  return h('div', {class: 'coin-market-balances', 'data-coin-balances': ''},
    h('div', {class: 'coin-market-balance'},
      h('span', {}, '⭐ ' + formatNumber(stars) + ' ' + localized(ctx, 'yulduz', 'stars')),
      detail(localized(ctx, 'Mashqdagi natijalar asosida. Reytingdagi o‘rningizni belgilang.',
        'Earned through study — determines your ranking position.'))),
    h('div', {class: 'coin-market-balance'},
      h('span', {}, '🪙 ' + formatNumber(wallet?.balance) + ' ' + localized(ctx, 'tanga', 'coins')),
      detail(localized(ctx, 'Kunlik kirish, mashqlar va do‘stlar uchun. Sovg‘alarga ishlating.',
        'From daily logins, tasks and friends — spend on gifts.'))));
}

function streakCard(ctx, data, claim, claiming, message) {
  const claimed = Boolean(data.claimed);
  const stage = Number(data.streak || 0);
  const label = claimed ?
    localized(ctx, 'Bugungi tanga olindi. Ertaga qayting.', 'Claimed today — come back tomorrow.') :
    localized(ctx, 'Bugun +' + data.nextCoins + ' tanga oling.', 'Claim +' + data.nextCoins + ' coins today.');
  return card(
    heading(localized(ctx, 'Kunlik mukofot · 7 kun', 'Daily reward · 7 days')),
    detail(label),
    h('div', {class: 'coin-streak-days', 'data-coin-streak': String(stage)},
      Array.from({length: 7}, (_, index) => h('div', {
        class: 'coin-streak-day' + ((claimed && index < stage) || (!claimed && index < stage) ? ' coin-streak-day--claimed' : ''),
        'data-streak-day': String(index + 1),
      }, '+' + (index + 1))),
    claimed ? h('p', {class: 'coin-market-ok'}, localized(ctx,
      'Bugun +' + data.todayCoins + ' tanga qo‘shildi.', 'Earned +' + data.todayCoins + ' today.')) :
      button(claiming ? localized(ctx, 'Tekshirilmoqda…', 'Claiming…') :
        localized(ctx, 'Bugungi tangani olish', 'Claim today’s coins'), claim,
      {class: 'btn-primary', disabled: claiming, 'data-coin-daily-claim': ''}),
    message ? detail(message) : null);
}

function earnCards(ctx) {
  return h('div', {class: 'coin-market-grid'},
    h('section', {class: 'coin-market-action'},
      h('span', {'aria-hidden': 'true'}, '📅'),
      h('strong', {}, '+1–7 🪙'),
      h('b', {}, localized(ctx, 'Har kuni', 'Every day')),
      detail(localized(ctx, 'Saytga kirish uchun', 'For checking in'))),
    h('section', {class: 'coin-market-action'},
      h('span', {'aria-hidden': 'true'}, '✅'),
      h('strong', {}, '+1 🪙'),
      h('b', {}, localized(ctx, 'Mashqlar', 'Tasks')),
      detail(localized(ctx, 'Har bir yangi tugallangan topshiriq', 'For each new completed task'))),
    h('section', {class: 'coin-market-action coin-market-action--friend'},
      h('span', {'aria-hidden': 'true'}, '👥'),
      h('strong', {}, '+10 🪙'),
      h('b', {}, localized(ctx, 'Do‘stlar', 'Friends')),
      detail(localized(ctx, 'Har bir yangi tasdiqlangan do‘st', 'Each verified new friend'))));
}

async function earnPanel(ctx, host, options) {
  host.replaceChildren(loading(ctx));
  const results = await Promise.allSettled([
    api.request('/api/coins/wallet', {signal: ctx.signal}),
    api.request('/api/coins/daily', {signal: ctx.signal}),
    api.request('/api/coins/referral-link', {method: 'POST', signal: ctx.signal}),
    api.request('/api/study-plan/rewards', {signal: ctx.signal}),
  ]);
  if (ctx.signal.aborted) return;
  const [walletResult, dailyResult, referralResult, pointsResult] = results;
  if (walletResult.status !== 'fulfilled' || dailyResult.status !== 'fulfilled') {
    host.replaceChildren(errorNotice(ctx)); return;
  }
  let wallet = walletResult.value;
  let daily = dailyResult.value;
  const link = referralResult.status === 'fulfilled' ? referralResult.value?.url : null;
  const referrals = referralResult.status === 'fulfilled' ? referralResult.value?.count ?? 0 : 0;
  const stars = pointsResult.status === 'fulfilled' ? pointsResult.value?.balance ?? 0 : options.stars;
  const status = h('p', {role: 'status', class: 'coin-market-notice'});
  let claiming = false;
  async function claim() {
    if (claiming || daily.claimed) return;
    claiming = true;
    render();
    try {
      const result = await api.request('/api/coins/daily/claim', {method: 'POST', signal: ctx.signal});
      daily = result;
      wallet = result.wallet || wallet;
      status.textContent = localized(ctx, 'Mukofot balansga qo‘shildi.', 'The reward was added to your balance.');
      claiming = false;
      render();
    } catch {
      claiming = false;
      status.textContent = localized(ctx, 'Mukofotni olish amalga oshmadi.', 'Unable to claim the reward.');
      render();
    }
  }
  function render() {
    const inviteFeedback = h('p', {role: 'status', class: 'coin-market-notice'});
    const invite = h('section', {class: 'coin-market-invite'},
      h('div', {},
        heading(localized(ctx, 'Do‘st taklif qiling — +10 tanga', 'Invite friends — get +10 coins')),
        detail(localized(ctx, 'Faqat bot orqali taklif qilingan va yangi faol hisob yaratgan do‘stlar uchun.',
          'Rewards are paid only for new, activated student accounts invited through the bot.')),
        detail(localized(ctx, 'Tasdiqlangan do‘stlar: ', 'Verified friends: ') + formatNumber(referrals))),
      link ? h('div', {class: 'coin-market-invite-actions'},
        h('a', {class: 'btn-primary', href: link, target: '_blank', rel: 'noopener noreferrer'},
          localized(ctx, 'Telegram orqali ochish', 'Open in Telegram')),
        button(localized(ctx, 'Havolani nusxalash', 'Copy invite link'), async () => {
          try {
            await navigator.clipboard.writeText(link);
            inviteFeedback.textContent = localized(ctx, 'Havola nusxalandi.', 'Invite link copied.');
          } catch {
            inviteFeedback.textContent = link;
          }
        }, {class: 'btn-secondary', 'data-coin-invite-copy': ''}),
        inviteFeedback) :
        detail(localized(ctx, 'Telegram taklif havolasi hozircha ishlamayapti.',
          'Telegram invite link is currently unavailable.')));
    host.replaceChildren(
      balanceCards(ctx, wallet, stars),
      h('section', {class: 'coin-market-summary'},
        heading(localized(ctx, 'Tanga yig‘ing — sovg‘alarni oling', 'Collect coins — get gifts')),
        detail(localized(ctx, 'Uch xil usul bilan yig‘ish mumkin. Do‘stlar eng katta mukofotni beradi.',
          'Three ways to earn. Friends bring the highest reward.')),
        earnCards(ctx)),
      streakCard(ctx, daily, () => void claim(), claiming, null),
      invite, status);
  }
  render();
}

async function giftsPanel(ctx, host) {
  host.replaceChildren(loading(ctx));
  if (ctx.session?.user?.role === 'owner') {
    await ownerGiftsPanel(ctx, host);
    return;
  }
  const data = await Promise.all([
    api.request('/api/coins/gifts', {signal: ctx.signal}),
    api.request('/api/coins/purchases', {signal: ctx.signal}),
    api.request('/api/coins/wallet', {signal: ctx.signal}),
  ]);
  if (ctx.signal.aborted) return;
  const [catalogue, history, wallet] = data;
  const owned = new Set((history.purchases || []).map(x => x.giftId));
  const feedback = h('p', {role: 'status', class: 'coin-market-notice'});
  const entries = (catalogue.gifts || []).map(gift => {
    const isOwned = owned.has(gift.id);
    const unavailable = gift.stock === 0 || gift.coins > wallet.balance;
    const action = button(isOwned ? localized(ctx, 'Olingan', 'Owned') :
      gift.stock === 0 ? localized(ctx, 'Tugagan', 'Out of stock') :
      unavailable ? localized(ctx, 'Tanga yetarli emas', 'Not enough coins') :
      localized(ctx, 'Sotib olish', 'Buy gift'), async event => {
        if (!window.confirm(localized(ctx, 'Sovg‘ani ' + gift.coins + ' tangaga sotib olasizmi?',
          'Buy this gift for ' + gift.coins + ' coins?'))) return;
        event.currentTarget.disabled = true;
        try {
          await api.request('/api/coins/gifts/' + encodeURIComponent(gift.id) + '/purchase', {
            method: 'POST', signal: ctx.signal, body: {requestId: crypto.randomUUID()},
          });
          if (!ctx.signal.aborted) void giftsPanel(ctx, host);
        } catch (error) {
          feedback.textContent = error.code === 'insufficient_coins' ?
            localized(ctx, 'Tanga yetarli emas.', 'Not enough coins.') :
            error.code === 'already_owned' ? localized(ctx, 'Bu sovg‘a sizda bor.', 'Already owned.') :
            localized(ctx, 'Xarid amalga oshmadi.', 'Purchase failed.');
          event.currentTarget.disabled = false;
        }
      }, {'data-coin-buy': gift.id, class: 'btn-primary', disabled: isOwned || unavailable});
    return h('article', {class: 'coin-gift-card', 'data-gift': gift.key},
      h('span', {class: 'coin-gift-symbol', 'aria-hidden': 'true'},
        {badge: '🏅', frame: '🖼️', theme: '🎨', study_tool: '📘'}[gift.category] || '🎁'),
      h('strong', {}, titleFor(ctx, gift)),
      detail(descriptionFor(ctx, gift)),
      h('div', {class: 'coin-gift-price'}, formatNumber(gift.coins), ' 🪙'),
      gift.stock !== null ? detail(localized(ctx, 'Qoldi: ', 'In stock: ') + gift.stock) : null,
      action);
  });
  host.replaceChildren(balanceCards(ctx, wallet),
    heading(localized(ctx, 'Sovg‘alar do‘koni', 'Gift marketplace')),
    entries.length ? h('div', {class: 'coin-gift-grid'}, entries) :
      card(detail(localized(ctx, 'Sovg‘alar hozircha qo‘shilmagan. Yangi sovg‘alar shu yerda chiqadi.',
        'No gifts are available yet. New gifts will appear here.'))),
    feedback);
}

async function purchasesPanel(ctx, host) {
  host.replaceChildren(loading(ctx));
  const [history, wallet] = await Promise.all([
    api.request('/api/coins/purchases', {signal: ctx.signal}),
    api.request('/api/coins/wallet', {signal: ctx.signal}),
  ]);
  if (ctx.signal.aborted) return;
  const items = (history.purchases || []).map(item =>
    h('article', {class: 'coin-market-purchase'},
      h('strong', {}, titleFor(ctx, item)),
      detail(new Date(item.purchasedAt).toLocaleDateString(ctx.locale === 'uz' ? 'uz-UZ' : 'en-US')),
      h('strong', {}, '−' + formatNumber(item.coins) + ' 🪙')));
  host.replaceChildren(balanceCards(ctx, wallet),
    heading(localized(ctx, 'Xaridlarim', 'My purchases')),
    items.length ? h('div', {class: 'coin-market-purchase-list'}, items) :
      card(detail(localized(ctx, 'Hali sovg‘a sotib olmagansiz.', 'You have not bought any gifts yet.'))));
}

async function ownerGiftsPanel(ctx, host) {
  const catalogue = await api.request('/api/coins/admin/gifts', {signal: ctx.signal});
  if (ctx.signal.aborted) return;
  const notice = h('p', {role: 'status', class: 'coin-market-notice'});
  const form = h('form', {class: 'coin-gift-admin-form'}, [
    ['key', 'Gift key', 'text'],
    ['titleUz', 'O‘zbekcha nomi', 'text'],
    ['titleEn', 'English title', 'text'],
    ['descriptionUz', 'O‘zbekcha tavsif', 'text'],
    ['descriptionEn', 'English description', 'text'],
    ['coins', 'Coin price', 'number'],
    ['stock', 'Stock (blank = unlimited)', 'number'],
  ].map(([name, label, type]) => h('label', {}, label,
    h('input', {name, type, min: type === 'number' ? (name === 'coins' ? 1 : 0) : null,
      max: type === 'number' ? 1000000 : null, required: !['stock', 'descriptionUz', 'descriptionEn'].includes(name),
      'data-coin-gift-input': name}))),
  h('label', {}, localized(ctx, 'Turi', 'Category'),
    h('select', {name: 'category'}, ['badge', 'frame', 'theme', 'study_tool'].map(name =>
      h('option', {value: name}, name)))),
  h('button', {class: 'btn-primary', type: 'submit'},
    localized(ctx, 'Sovg‘ani qo‘shish', 'Add gift')));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(form);
    const payload = {
      key: String(data.get('key') || '').trim(),
      titleUz: String(data.get('titleUz') || '').trim(),
      titleEn: String(data.get('titleEn') || '').trim(),
      descriptionUz: String(data.get('descriptionUz') || '').trim(),
      descriptionEn: String(data.get('descriptionEn') || '').trim(),
      coins: Number(data.get('coins')),
      category: String(data.get('category')),
      stock: data.get('stock') === '' ? null : Number(data.get('stock')),
      active: true,
    };
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      await api.request('/api/coins/admin/gifts', {method: 'POST', body: payload, signal: ctx.signal});
      if (!ctx.signal.aborted) await ownerGiftsPanel(ctx, host);
    } catch {
      notice.textContent = localized(ctx, 'Sovg‘ani saqlab bo‘lmadi. Kalit noyob bo‘lishi kerak.',
        'Unable to save gift. The gift key must be unique.');
      submit.disabled = false;
    }
  }, {signal: ctx.signal});
  const cards = (catalogue.gifts || []).map(gift => h('div', {class: 'coin-market-purchase'},
    h('strong', {}, titleFor(ctx, gift) + ' · ' + gift.coins + ' 🪙'),
    detail(gift.active ? localized(ctx, 'Faol', 'Active') : localized(ctx, 'Yashirilgan', 'Hidden')),
    button(gift.active ? localized(ctx, 'Yashirish', 'Hide') : localized(ctx, 'Faollashtirish', 'Activate'),
      async event => {
        event.currentTarget.disabled = true;
        try {
          await api.request('/api/coins/admin/gifts/' + encodeURIComponent(gift.id), {
            method: 'PATCH', body: {active: !gift.active}, signal: ctx.signal,
          });
          await ownerGiftsPanel(ctx, host);
        } catch {
          notice.textContent = localized(ctx, 'Holatni o‘zgartirib bo‘lmadi.', 'Unable to update gift.');
          event.currentTarget.disabled = false;
        }
      }, {class: 'btn-secondary'})));
  host.replaceChildren(heading(localized(ctx, 'Sovg‘alarni boshqarish', 'Manage gifts')),
    detail(localized(ctx, 'Sovg‘alar faqat talaba tanga balansiga sotiladi. Xaridlar qaytarilmaydi.',
      'Only student coin balances can be spent on gifts. Purchases are final.')),
    form, notice, h('div', {class: 'coin-market-purchase-list'}, cards));
}

export async function showCoinFeature(ctx, mode, host, options = {}) {
  try {
    if (mode === 'earn') {
      await earnPanel(ctx, host, options);
    } else if (mode === 'gifts') {
      await giftsPanel(ctx, host);
    } else if (mode === 'purchases') {
      await purchasesPanel(ctx, host);
    }
  } catch {
    if (!ctx.signal.aborted) host.replaceChildren(errorNotice(ctx));
  }
}
