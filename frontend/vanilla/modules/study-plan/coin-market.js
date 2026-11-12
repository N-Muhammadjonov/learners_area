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
      h('span', {}, '🟡 ' + formatNumber(wallet?.balance) + ' ' + localized(ctx, 'tanga', 'coins')),
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
      }, '+' + (index + 1)))),
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
      h('strong', {}, '+1–7 🟡'),
      h('b', {}, localized(ctx, 'Har kuni', 'Every day')),
      detail(localized(ctx, 'Saytga kirish uchun', 'For checking in'))),
    h('section', {class: 'coin-market-action'},
      h('span', {'aria-hidden': 'true'}, '✅'),
      h('strong', {}, '+1 🟡'),
      h('b', {}, localized(ctx, 'Mashqlar', 'Tasks')),
      detail(localized(ctx, 'Har bir yangi tugallangan topshiriq', 'For each new completed task'))),
    h('section', {class: 'coin-market-action coin-market-action--friend'},
      h('span', {'aria-hidden': 'true'}, '👥'),
      h('strong', {}, '+10 🟡'),
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
  const stars = pointsResult.status === 'fulfilled' ? pointsResult.value?.totalEarned ?? 0 : options.stars;
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

async function giftsPanel(ctx, host, successMessage = "") {
  host.replaceChildren(loading(ctx));
  const data = await Promise.all([
    api.request('/api/coins/gifts', {signal: ctx.signal}),
    api.request('/api/coins/purchases', {signal: ctx.signal}),
    api.request('/api/coins/wallet', {signal: ctx.signal}),
  ]);
  if (ctx.signal.aborted) return;
  const [catalogue, history, wallet] = data;
  const owned = new Set((history.purchases || []).filter(x => x.status !== 'rejected').map(x => x.giftId));
  const feedback = h('p', {role: 'status', class: 'coin-market-notice'}, successMessage);
  const entries = (catalogue.gifts || []).map(gift => {
    const isOwned = owned.has(gift.id);
    const unavailable = gift.stock === 0 || gift.coins > wallet.balance;
    const action = button(isOwned ? localized(ctx, 'Olingan', 'Owned') :
      gift.stock === 0 ? localized(ctx, 'Tugagan', 'Out of stock') :
      unavailable ? localized(ctx, 'Tanga yetarli emas', 'Not enough coins') :
      localized(ctx, 'Sotib olish', 'Buy gift'), async event => {
        const dialog = h('dialog', {class: 'coin-purchase-dialog', 'data-coin-purchase-dialog': gift.id},
          h('h3', {}, titleFor(ctx, gift)),
          detail(localized(ctx,
            'Ushbu sovg‘ani ' + gift.coins + ' tilla tangaga sotib olishga rozimisiz?',
            'Do you agree to buy this gift for ' + gift.coins + ' gold coins?')),
          h('div', {class: 'coin-order-actions'},
            button(localized(ctx, 'Yo‘q', 'No'), () => dialog.close(), {class: 'btn-secondary'}),
            button(localized(ctx, 'Ha', 'Yes'), async confirmEvent => {
              confirmEvent.currentTarget.disabled = true;
              event.currentTarget.disabled = true;
              try {
                const receipt = await api.request('/api/coins/gifts/' + encodeURIComponent(gift.id) + '/purchase', {
                  method: 'POST', signal: ctx.signal, body: {requestId: crypto.randomUUID()},
                });
                dialog.close();
                if (!ctx.signal.aborted) void giftsPanel(ctx, host, localized(ctx,
                  'Xaridingiz uchun raxmat tez orada admin sizga aloqaga chiqadi. Chek: ' + receipt.receiptId,
                  'Thank you for your purchase. An administrator will contact you soon. Receipt: ' + receipt.receiptId));
              } catch (error) {
                feedback.textContent = error.code === 'insufficient_coins' ?
                  localized(ctx, 'Tanga yetarli emas.', 'Not enough coins.') :
                  error.code === 'already_owned' ? localized(ctx, 'Bu sovg‘a sizda bor.', 'Already owned.') :
                  localized(ctx, 'Xarid amalga oshmadi.', 'Purchase failed.');
                confirmEvent.currentTarget.disabled = false;
                event.currentTarget.disabled = false;
                dialog.close();
              }
            }, {class: 'btn-primary', 'data-coin-purchase-confirm': gift.id})));
        dialog.addEventListener('close', () => dialog.remove(), {once: true});
        document.body.append(dialog);
        dialog.showModal();
      }, {'data-coin-buy': gift.id, class: 'btn-primary', disabled: isOwned || unavailable});
    return h('article', {class: 'coin-gift-card', 'data-gift': gift.key},
      gift.imageData ? h('img', {class: 'coin-gift-image', src: gift.imageData,
        alt: titleFor(ctx, gift), loading: 'lazy', decoding: 'async'}) :
        h('span', {class: 'coin-gift-symbol', 'aria-hidden': 'true'},
          {badge: '🏅', frame: '🖼️', theme: '🎨', study_tool: '📘'}[gift.category] || '🎁'),
      h('strong', {}, titleFor(ctx, gift)),
      detail(descriptionFor(ctx, gift)),
      h('div', {class: 'coin-gift-price'}, formatNumber(gift.coins), ' 🟡'),
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
  const completed = (history.purchases || []).filter(item => item.status === 'fulfilled');
  const processing = (history.purchases || []).filter(item => item.status === 'pending');
  const rejected = (history.purchases || []).filter(item => item.status === 'rejected');
  const purchaseCard = item => h('article', {class: 'coin-market-purchase',
    'data-coin-purchase-status': item.status},
    h('strong', {}, titleFor(ctx, item)),
    detail(new Date(item.purchasedAt).toLocaleDateString(ctx.locale === 'uz' ? 'uz-UZ' : 'en-US')),
    detail(({pending: localized(ctx, 'Ko‘rib chiqilmoqda', 'Awaiting fulfillment'),
      fulfilled: localized(ctx, 'Bajarilgan', 'Fulfilled'),
      rejected: localized(ctx, 'Rad etildi — tangalar qaytarildi', 'Rejected — coins refunded')})[item.status]),
    h('strong', {}, (item.status === 'rejected' ? '+' : '−') + formatNumber(item.coins) + ' 🟡'));
  host.replaceChildren(balanceCards(ctx, wallet),
    processing.length ? h('section', {class: 'coin-purchase-section', 'data-coin-pending-orders': ''},
      heading(localized(ctx, 'Jarayondagi buyurtmalar', 'Pending orders')),
      h('div', {class: 'coin-market-purchase-list'}, processing.map(purchaseCard))) : null,
    heading(localized(ctx, 'Xaridlarim', 'My purchases')),
    completed.length ? h('div', {class: 'coin-market-purchase-list', 'data-coin-completed-orders': ''},
      completed.map(purchaseCard)) :
      card(detail(localized(ctx, 'Hali bajarilgan xaridingiz yo‘q.',
        'You do not have fulfilled purchases yet.'))),
    rejected.length ? h('section', {class: 'coin-purchase-section', 'data-coin-rejected-orders': ''},
      heading(localized(ctx, 'Rad etilgan buyurtmalar', 'Rejected orders')),
      h('div', {class: 'coin-market-purchase-list'}, rejected.map(purchaseCard))) : null);
}

async function imageDataFromFile(file) {
  if (!(file instanceof File) || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      file.size < 1 || file.size > 160000) throw new Error('invalid_image');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const valid = file.type === 'image/png' && bytes[0] === 137 && bytes[1] === 80 &&
    bytes[2] === 78 && bytes[3] === 71 ||
    file.type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ||
    file.type === 'image/webp' && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (!valid) throw new Error('invalid_image');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return 'data:' + file.type + ';base64,' + btoa(binary);
}

async function ownerGiftsPanel(ctx, host) {
  host.replaceChildren(loading(ctx));
  const [catalogue, orders] = await Promise.all([
    api.request('/api/coins/admin/gifts', {signal: ctx.signal}),
    api.request('/api/coins/admin/purchases', {signal: ctx.signal}),
  ]);
  if (ctx.signal.aborted) return;
  const notice = h('p', {role: 'status', class: 'coin-market-notice', 'aria-live': 'polite'});
  const fields = [
    ['key', 'Gift key', 'text'],
    ['titleUz', 'O‘zbekcha nomi', 'text'],
    ['titleEn', 'English title', 'text'],
    ['descriptionUz', 'O‘zbekcha tavsif', 'text'],
    ['descriptionEn', 'English description', 'text'],
    ['coins', 'Coin price', 'number'],
    ['stock', 'Stock (blank = unlimited)', 'number'],
  ];
  const form = h('form', {class: 'coin-gift-admin-form'},
    fields.map(([name, label, type]) => h('label', {}, label,
      h('input', {name, type, min: type === 'number' ? (name === 'coins' ? 1 : 0) : null,
        max: type === 'number' ? 1000000 : null,
        required: !['stock', 'descriptionUz', 'descriptionEn'].includes(name),
        'data-coin-gift-input': name}))),
    h('label', {}, localized(ctx, 'Sovg‘a rasmi (PNG, JPG, WebP · 160 KB)', 'Gift image (PNG, JPG, WebP · 160 KB)'),
      h('input', {name: 'image', type: 'file', accept: 'image/png,image/jpeg,image/webp'})),
    h('label', {}, localized(ctx, 'Turi', 'Category'),
      h('select', {name: 'category'}, ['badge', 'frame', 'theme', 'study_tool'].map(name =>
        h('option', {value: name}, name)))),
    h('button', {class: 'btn-primary', type: 'submit'},
      localized(ctx, 'Sovg‘ani qo‘shish', 'Add gift')));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(form);
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    try {
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
      const imageFile = data.get('image');
      if (imageFile?.size) payload.imageData = await imageDataFromFile(imageFile);
      await api.request('/api/coins/admin/gifts', {method: 'POST', body: payload, signal: ctx.signal});
      if (!ctx.signal.aborted) await ownerGiftsPanel(ctx, host);
    } catch (error) {
      notice.textContent = error.message === 'invalid_image' ?
        localized(ctx, 'Faqat haqiqiy PNG/JPG/WebP, 160 KB gacha.', 'Use a real PNG/JPG/WebP image up to 160 KB.') :
        localized(ctx, 'Sovg‘ani saqlab bo‘lmadi. Kalit noyob bo‘lishi kerak.',
          'Unable to save gift. The gift key must be unique.');
      submit.disabled = false;
    }
  }, {signal: ctx.signal});

  const cards = (catalogue.gifts || []).map(gift => {
    const fileInput = h('input', {type: 'file', accept: 'image/png,image/jpeg,image/webp',
      'aria-label': localized(ctx, 'Sovg‘a rasmini almashtirish', 'Replace gift image'),
      'data-gift-image-upload': gift.id});
    fileInput.addEventListener('change', async () => {
      if (!fileInput.files?.[0]) return;
      fileInput.disabled = true;
      try {
        const imageData = await imageDataFromFile(fileInput.files[0]);
        await api.request('/api/coins/admin/gifts/' + encodeURIComponent(gift.id), {
          method: 'PATCH', body: {imageData}, signal: ctx.signal,
        });
        if (!ctx.signal.aborted) await ownerGiftsPanel(ctx, host);
      } catch {
        notice.textContent = localized(ctx, 'Rasm yuklanmadi (160 KB chegarasi).',
          'Unable to upload image (160 KB limit).');
        fileInput.disabled = false;
      }
    }, {signal: ctx.signal});
    return h('article', {class: 'coin-market-purchase'},
      gift.imageData ? h('img', {class: 'coin-gift-admin-thumbnail', src: gift.imageData, alt: titleFor(ctx, gift)}) : null,
      h('strong', {}, titleFor(ctx, gift) + ' · ' + gift.coins + ' 🟡'),
      detail(gift.active ? localized(ctx, 'Faol', 'Active') : localized(ctx, 'Yashirilgan', 'Hidden')),
      fileInput,
      button(gift.active ? localized(ctx, 'Yashirish', 'Hide') : localized(ctx, 'Faollashtirish', 'Activate'),
        async event => {
          event.currentTarget.disabled = true;
          try {
            await api.request('/api/coins/admin/gifts/' + encodeURIComponent(gift.id), {
              method: 'PATCH', body: {active: !gift.active}, signal: ctx.signal,
            });
            if (!ctx.signal.aborted) await ownerGiftsPanel(ctx, host);
          } catch {
            notice.textContent = localized(ctx, 'Holatni o‘zgartirib bo‘lmadi.', 'Unable to update gift.');
            event.currentTarget.disabled = false;
          }
        }, {class: 'btn-secondary'}));
  });
  const purchaseCards = (orders.purchases || []).map(order => h('article', {
    class: 'coin-market-purchase', 'data-purchase-id': order.id,
  },
    h('div', {}, h('strong', {}, order.buyerName),
      detail(titleFor(ctx, order) + ' · ' + formatNumber(order.coins) + ' 🟡'),
      detail(localized(ctx, 'Chek: ', 'Receipt: ') + order.id),
      detail(new Date(order.purchasedAt).toLocaleString(ctx.locale === 'uz' ? 'uz-UZ' : 'en-US')),
      order.telegramUrl ? h('a', {href: order.telegramUrl, class: 'btn-secondary', target: '_blank',
        rel: 'noopener noreferrer', 'data-coin-telegram-contact': order.id},
        localized(ctx, 'Telegram orqali bog‘lanish', 'Contact on Telegram')) :
        detail(localized(ctx, 'Telegram akkaunti topilmadi', 'Telegram account unavailable'))),
    h('span', {}, ({pending: localized(ctx, 'Kutilmoqda', 'Pending'),
      fulfilled: localized(ctx, 'Bajarilgan', 'Fulfilled'),
      rejected: localized(ctx, 'Rad etilgan', 'Rejected')})[order.status] || order.status),
    order.status === 'pending' ? h('div', {class: 'coin-order-actions'},
      ...[['fulfilled', 'Bajarildi', 'Fulfilled'], ['rejected', 'Rad etish', 'Reject']].map(
        ([status, uz, en]) => button(localized(ctx, uz, en), async event => {
          if (!window.confirm(localized(ctx,
            status === 'rejected' ? 'Xaridni rad etib, tangalarni qaytarasizmi?' : 'Sovg‘a yetkazildimi?',
            status === 'rejected' ? 'Reject and refund the coins?' : 'Was the gift delivered?'))) return;
          event.currentTarget.disabled = true;
          try {
            await api.request('/api/coins/admin/purchases/' + encodeURIComponent(order.id), {
              method: 'PATCH', body: {status}, signal: ctx.signal,
            });
            if (!ctx.signal.aborted) await ownerGiftsPanel(ctx, host);
          } catch {
            notice.textContent = localized(ctx, 'Xarid holati yangilanmadi.',
              'Unable to update the order status.');
            event.currentTarget.disabled = false;
          }
        }, {class: status === 'fulfilled' ? 'btn-primary' : 'btn-secondary'}))) : null));
  host.replaceChildren(
    heading(localized(ctx, 'Sovg‘alar va xaridlarni boshqarish', 'Manage gifts and purchases')),
    detail(localized(ctx, 'Har bir xarid owner tomonidan ko‘riladi. Rad etilganda tanga qaytariladi.',
      'Each purchase is reviewed by the owner. Rejected orders are refunded.')),
    notice, form, h('div', {class: 'coin-market-purchase-list'}, cards),
    heading(localized(ctx, 'Xarid cheklari', 'Purchase receipts')),
    purchaseCards.length ? h('div', {class: 'coin-market-purchase-list'}, purchaseCards) :
      detail(localized(ctx, 'Hali xarid yo‘q.', 'No purchases yet.')));
}

export async function showCoinFeature(ctx, mode, host, options = {}) {
  try {
    if (mode === 'earn') {
      await earnPanel(ctx, host, options);
    } else if (mode === 'gifts') {
      await giftsPanel(ctx, host);
    } else if (mode === 'purchases') {
      await purchasesPanel(ctx, host);
    } else if (mode === 'manage' && ctx.session?.user?.role === 'owner') {
      await ownerGiftsPanel(ctx, host);
    }
  } catch {
    if (!ctx.signal.aborted) host.replaceChildren(errorNotice(ctx));
  }
}
