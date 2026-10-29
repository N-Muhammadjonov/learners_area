import {el, mountStaff, heading} from './kit.js';
import {RiwiClientAdapter} from '../../js/adapters/riwi.js';
import {tRiwi} from '../../js/i18n/riwi_i18n.js';
import {escapeHtml} from '../riwi/index.js';

export const OWNER_RIWI_ROUTE = "/app/owner/riwi";

export function createOwnerRiwiControlRoom({
  role = "owner",
  locale = "uz",
  theme = "day",
  adapter = RiwiClientAdapter
} = {}) {
  if (role !== "owner") {
    throw new Error("owner_role_required");
  }
  const state = {
    activeTab: "diagnostics",
    locale: locale === "en" ? "en" : "uz",
    theme: theme === "night" ? "night" : "day",
    diagnostics: null,
    knowledgeItems: [],
    learningSignals: [],
    securitySignals: [],
    providerExperiments: [],
    assessmentPolicies: [],
    auditItems: [],
    auditNextCursor: null
  };

  function setTab(tabId) {
    const valid = new Set(["diagnostics", "knowledge", "policies", "signals", "providerLab", "audit"]);
    if (valid.has(tabId)) {
      state.activeTab = tabId;
    }
    return state.activeTab;
  }

  function renderHtml() {
    const tabs = [
      ["diagnostics", tRiwi("riwi.owner.tab.diagnostics", state.locale)],
      ["knowledge", tRiwi("riwi.owner.tab.knowledge", state.locale)],
      ["policies", tRiwi("riwi.owner.tab.policies", state.locale)],
      ["signals", tRiwi("riwi.owner.tab.signals", state.locale)],
      ["providerLab", tRiwi("riwi.owner.tab.providerLab", state.locale)],
      ["audit", tRiwi("riwi.owner.tab.audit", state.locale)]
    ];
    const navHtml = tabs
      .map(
        ([id, label]) =>
          `<button type="button" class="riwi-owner-tab${state.activeTab === id ? " is-active" : ""}" data-tab="${escapeHtml(id)}">${escapeHtml(label)}</button>`
      )
      .join("");

    return `<section class="riwi-owner-room" data-theme="${escapeHtml(state.theme)}">
      <header class="riwi-owner-room__header">
        <h1>${escapeHtml(tRiwi("riwi.owner.title", state.locale))}</h1>
        <nav class="riwi-owner-room__tabs">${navHtml}</nav>
      </header>
      <div class="riwi-owner-room__panel" data-active-tab="${escapeHtml(state.activeTab)}"></div>
    </section>`;
  }

  async function refreshDiagnostics() {
    state.diagnostics = await adapter.getOwnerDiagnostics();
    return state.diagnostics;
  }

  async function refreshSecuritySignals() {
    const res = await adapter.getOwnerSecuritySignals();
    state.securitySignals = Array.isArray(res?.items) ? res.items : [];
    return state.securitySignals;
  }

  async function refreshAudit(cursor = null) {
    const res = await adapter.getOwnerAudit(cursor);
    state.auditItems = Array.isArray(res?.items) ? res.items : [];
    state.auditNextCursor = res?.nextCursor || null;
    return res;
  }

  return {
    state,
    setTab,
    renderHtml,
    refreshDiagnostics,
    refreshSecuritySignals,
    refreshAudit
  };
}

export const mount = mountStaff({
  name: 'owner-riwi',
  roles: ['owner'],
  load: async () => RiwiClientAdapter.getOwnerDiagnostics(),
  render(ctx, data) {
    const locale = ctx.locale === 'en' ? 'en' : 'uz';
    const providers = Array.isArray(data?.providers) ? data.providers : [];
    return el('div', {class: 'mx-auto flex max-w-4xl flex-col gap-6', 'data-owner-riwi': ''},
      heading(tRiwi('riwi.owner.title', locale), tRiwi('riwi.subtitle.owner', locale)),
      el('section', {class: 'card p-5 flex flex-col gap-3'},
        el('h2', {class: 'font-display text-lg text-ink-900'}, tRiwi('riwi.owner.tab.diagnostics', locale)),
        el('p', {class: 'text-sm text-ink-500'}, `Rollout enabled: ${Boolean(data?.rollout?.enabled)}`),
        el('div', {class: 'grid gap-2'},
          ...providers.map((p) =>
            el('div', {class: 'flex items-center justify-between text-sm text-ink-900', 'data-provider-id': p.id},
              el('span', {class: 'font-medium'}, p.displayName || p.id),
              el('span', {class: 'text-ink-500'}, p.secretsPresent ? 'Ready' : 'Unconfigured')
            )
          )
        )
      )
    );
  }
});
