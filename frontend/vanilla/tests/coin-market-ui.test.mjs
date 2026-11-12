import {test, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {api} from '../js/api-client.js';
import {showCoinFeature} from '../modules/study-plan/coin-market.js';
import {rewardBadge} from '../modules/shared/coin-reward.js';

let dom, root, controller, originalRequest;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const gift = {
  id: 'a0000000-0000-4000-8000-000000000001',
  key: 'test-gift', titleUz: 'Sovg‘a', titleEn: 'Gift',
  descriptionUz: 'Test tavsif', descriptionEn: 'Test description',
  category: 'badge', coins: 5, stock: 3, imageData: null,
};
const base = (role = 'student') => ({
  root, signal: controller.signal, locale: 'uz',
  session: {user: {role}}, dict: {common: {loading: 'Yuklanmoqda'},
    errors: {unknown: 'Xatolik'}},
});
beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>',
    {url: 'https://fixture.invalid/app/leaderboard'});
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLDialogElement = dom.window.HTMLDialogElement;
  globalThis.File = dom.window.File;
  globalThis.FormData = dom.window.FormData;
  if (dom.window.HTMLDialogElement) {
    dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    dom.window.HTMLDialogElement.prototype.close = function () {
      this.open = false;
      this.dispatchEvent(new dom.window.Event('close'));
    };
  }
  root = document.getElementById('root');
  controller = new dom.window.AbortController();
  originalRequest = api.request;
});
afterEach(() => {
  controller.abort();
  api.request = originalRequest;
  dom.window.close();
  for (const name of ['window', 'document', 'Node', 'HTMLElement', 'HTMLDialogElement',
    'File', 'FormData']) delete globalThis[name];
});

test('buyer confirms exact price with Ha, then sees the success receipt', async () => {
  let purchases = [], writes = 0;
  api.request = async (path, options) => {
    if (path === '/api/coins/gifts') return {gifts: [gift]};
    if (path === '/api/coins/purchases') return {purchases};
    if (path === '/api/coins/wallet') return {balance: purchases.length ? 3 : 8, earned: 8};
    if (path.endsWith('/purchase')) {
      writes++;
      assert.equal(options.method, 'POST');
      assert.equal(typeof options.body.requestId, 'string');
      purchases = [{giftId: gift.id, id: 'receipt-123', status: 'pending',
        titleUz: gift.titleUz, titleEn: gift.titleEn, coins: gift.coins,
        purchasedAt: new Date().toISOString()}];
      return {ok: true, status: 'pending', receiptId: 'receipt-123'};
    }
    throw Error('Unknown route: ' + path);
  };
  await showCoinFeature(base(), 'gifts', root);
  root.querySelector('[data-coin-buy]').click();
  const dialog = document.querySelector('[data-coin-purchase-dialog]');
  assert(dialog);
  assert.match(dialog.textContent, /5 tilla tangaga/);
  assert.equal(writes, 0);
  dialog.querySelector('[data-coin-purchase-confirm]').click();
  await flush(); await flush();
  assert.equal(writes, 1);
  assert.match(root.textContent, /Xaridingiz uchun raxmat tez orada admin sizga aloqaga chiqadi/);
});

test('only fulfilled orders appear in completed purchase history', async () => {
  const orders = [
    {id: 'p', status: 'pending', coins: 3, titleUz: 'Kutmoqda', purchasedAt: new Date().toISOString()},
    {id: 'f', status: 'fulfilled', coins: 4, titleUz: 'Bajarilgan', purchasedAt: new Date().toISOString()},
    {id: 'r', status: 'rejected', coins: 2, titleUz: 'Rad etilgan', purchasedAt: new Date().toISOString()},
  ];
  api.request = async path => path === '/api/coins/purchases'
    ? {purchases: orders} : {earned: 8, balance: 6};
  await showCoinFeature(base(), 'purchases', root);
  const complete = root.querySelector('[data-coin-completed-orders]');
  assert(complete);
  assert.match(complete.textContent, /Bajarilgan/);
  assert(!complete.textContent.includes('Kutmoqda'));
  assert(!complete.textContent.includes('Rad etilgan'));
  assert.equal(root.querySelectorAll('[data-coin-pending-orders] article').length, 1);
  assert.equal(root.querySelectorAll('[data-coin-rejected-orders] article').length, 1);
});

test('owner sees same marketplace as student; receipts show Telegram link only in management', async () => {
  api.request = async path => {
    if (path === '/api/coins/gifts') return {gifts: [gift]};
    if (path === '/api/coins/purchases') return {purchases: []};
    if (path === '/api/coins/wallet') return {earned: 10, balance: 10};
    if (path === '/api/coins/admin/gifts') return {gifts: [gift]};
    if (path === '/api/coins/admin/purchases') return {purchases: [{
      id: 'purchase-123', buyerName: 'Buyer', titleUz: gift.titleUz,
      titleEn: gift.titleEn, coins: 5, status: 'pending', telegramUrl: 'https://t.me/buyer_username',
      purchasedAt: new Date().toISOString(),
    }]};
    throw Error('Unknown route: ' + path);
  };
  await showCoinFeature(base('owner'), 'gifts', root);
  assert.equal(root.querySelectorAll('[data-coin-buy]').length, 1);
  assert(!root.textContent.includes('Xarid cheklari'));
  await showCoinFeature(base('owner'), 'manage', root);
  assert(root.querySelector('[data-management-coin-gifts]') === null);
  const contact = root.querySelector('[data-coin-telegram-contact]');
  assert.equal(contact?.getAttribute('href'), 'https://t.me/buyer_username');
  assert(root.textContent.includes('Bajarildi'));
});

test('gold reward badge does not advertise unverified Speaking coins', () => {
  assert.equal(rewardBadge(base(), 'speaking'), null);
  const badge = rewardBadge(base(), 'vocabulary');
  assert.match(badge.textContent, /har 5 ta yangi/);
  assert(badge.querySelector('.la-gold-coin'));
  assert.equal(rewardBadge(base(), 'unknown'), null);
});
