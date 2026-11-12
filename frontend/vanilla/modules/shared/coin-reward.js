import {h} from '../../js/native.js';

/** Only show rewards that the server-side coin policy can verify. */
const RULES = Object.freeze({
  listening: {coins: 1, uz: 'har bir yangi tugallangan mashq', en: 'per newly completed exercise'},
  reading: {coins: 1, uz: 'har bir yangi tugallangan mashq', en: 'per newly completed exercise'},
  grammar: {coins: 1, uz: 'har bir tasdiqlangan mashq bloki', en: 'per verified exercise block'},
  writing: {coins: 1, uz: 'har bir qabul qilingan yakuniy ish', en: 'per accepted final submission'},
  articles: {coins: 1, uz: 'barcha savollar bajarilganda', en: 'after all article questions'},
  vocabulary: {coins: 1, uz: 'har 5 ta yangi o‘zlashtirilgan so‘z', en: 'per 5 newly mastered words'},
  ted: {coins: 1, uz: 'har 5 daqiqa faol ko‘rish', en: 'per 5 min active watching'},
  podcast: {coins: 1, uz: 'har 5 daqiqa faol tinglash', en: 'per 5 min active listening'},
});

export function rewardBadge(ctx, kind) {
  const rule = RULES[kind];
  if (!rule) return null;
  return h('span', {class: 'la-coin-reward', 'data-coin-reward-for': kind,
    'aria-label': (ctx.locale === 'uz' ? 'Tanga mukofoti: ' : 'Coin reward: ') +
      '+' + rule.coins + ' ' + (ctx.locale === 'uz' ? rule.uz : rule.en)},
  h('span', {class: 'la-gold-coin', 'aria-hidden': 'true'}, 'C'),
  h('span', {}, '+' + rule.coins + ' ' + (ctx.locale === 'uz' ? rule.uz : rule.en)));
}
