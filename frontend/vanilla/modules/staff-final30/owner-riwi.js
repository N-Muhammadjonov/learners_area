import {el, listen, mountStaff, heading} from './kit.js';
import {RiwiClientAdapter} from '../../js/adapters/riwi.js';
import {tRiwi} from '../../js/i18n/riwi_i18n.js';
import {escapeHtml} from '../riwi/index.js';

export const OWNER_RIWI_ROUTE = "/app/owner/riwi";

export function assessmentPolicyPanel(ctx, items = [], adapter = RiwiClientAdapter) {
  const en = ctx.locale === 'en';
  const text = (english, uzbek) => en ? english : uzbek;
  const host = el('section', {class:'card p-5 flex flex-col gap-3','data-riwi-policy-panel':''});
  const scope = el('select', {class:'input','aria-label':text('Task scope','Vazifa turi')},
    ...[['writing.task1.*','Writing Task 1'],['writing.task2.*','Writing Task 2'],['speaking.part1','Speaking Part 1'],
      ['speaking.part2','Speaking Part 2'],['speaking.part3','Speaking Part 3'],['grammar.*','Grammar'],['vocabulary.*','Vocabulary']]
      .map(([value,label]) => el('option',{value},label)));
  const style = el('select', {class:'input','aria-label':text('Feedback style','Izoh uslubi')},
    ...[['concise',text('Concise','Qisqa')],['balanced',text('Balanced','Muvozanatli')],['step_by_step',text('Step by step','Bosqichma-bosqich')]]
      .map(([value,label]) => el('option',{value},label)));
  const count = el('input',{type:'number',min:'1',max:'3',value:'3',class:'input',
    'aria-label':text('Maximum main weaknesses','Asosiy kamchiliklar soni')});
  const message = el('p',{role:'status',class:'text-sm text-ink-500'});
  const preview = el('button',{type:'button',class:'btn-secondary'},text('Preview','Ko‘rib chiqish'));
  const save = el('button',{type:'button',class:'btn-primary',disabled:true},text('Save candidate','Nomzodni saqlash'));
  const list = el('div',{class:'flex flex-col gap-3'});
  let reviewed = null;
  let busy = false;
  const invalidate = () => { reviewed=null; save.disabled=true; message.textContent=''; };
  for (const control of [scope,style,count]) listen(control,'input',invalidate,ctx.signal);
  async function action(work) {
    if(busy || ctx.signal.aborted)return;
    busy=true;preview.disabled=true;save.disabled=true;
    for(const control of [scope,style,count])control.disabled=true;
    for(const button of list.querySelectorAll('button'))button.disabled=true;
    message.textContent=text('Working…','Bajarilmoqda…');
    try {await work();}
    catch {message.textContent=text('The change was not saved. Refresh and review it again.','O‘zgarish saqlanmadi. Yangilab, qayta ko‘rib chiqing.');}
    finally {busy=false;if(!ctx.signal.aborted){preview.disabled=false;save.disabled=!reviewed;
      for(const control of [scope,style,count])control.disabled=false;
      for(const button of list.querySelectorAll('button'))button.disabled=false;}}
  }
  function renderItems(rows) {
    if(ctx.signal.aborted)return;
    list.replaceChildren(...rows.map(item=>{
      const card=el('div',{class:'rounded-xl border border-ink-200 p-3 flex flex-col gap-2'},
        el('p',{class:'text-sm text-ink-900'},`${item.scope} · ${item.version} · ${item.state}`),
        el('p',{class:'text-sm text-ink-500'},text('Main weaknesses: ','Asosiy kamchiliklar: ')+String(item.overlay?.maxWeaknesses??3)));
      const decisions=item.state==='candidate'?['approve','reject']:['approved','superseded'].includes(item.state)?['rollback']:[];
      for(const decision of decisions){
        const label={approve:text('Approve','Tasdiqlash'),reject:text('Reject','Rad etish'),rollback:text('Restore as new version','Yangi versiyada tiklash')}[decision];
        const button=el('button',{type:'button',class:'btn-secondary text-sm'},label);
        listen(button,'click',()=>void action(async()=>{
          await adapter[`${decision}AssessmentPolicy`](item.id,item.contentHash);
          const result=await adapter.getAssessmentPolicies();renderItems(result.items||[]);
          message.textContent=text('Version saved. Previous assessments keep their original rules.','Versiya saqlandi. Oldingi baholashlarning qoidalari saqlanadi.');
        }),ctx.signal);card.append(button);
      }
      return card;
    }));
  }
  listen(preview,'click',()=>void action(async()=>{
    const n=Number(count.value);
    if(!Number.isInteger(n)||n<1||n>3)throw Error('invalid_count');
    const proposal={scope:scope.value,overlay:{feedbackStyle:style.value,maxWeaknesses:n}};
    const result=await adapter.previewAssessmentPolicy(proposal);
    if(!result.regression?.passed)throw Error('regression_failed');
    reviewed=proposal;
    message.textContent=text(`Preview: ${scope.value}, at most ${n} main weaknesses.`,`${scope.value}: ko‘pi bilan ${n} ta asosiy kamchilik.`);
  }),ctx.signal);
  listen(save,'click',()=>void action(async()=>{
    if(!reviewed)return;
    await adapter.createAssessmentPolicy(reviewed);reviewed=null;
    const result=await adapter.getAssessmentPolicies();renderItems(result.items||[]);
    message.textContent=text('Candidate saved. Review it before approval.','Nomzod saqlandi. Tasdiqlashdan oldin tekshiring.');
  }),ctx.signal);
  host.append(el('h2',{class:'font-display text-lg text-ink-900'},text('Assessment teaching rules','Baholash izohlarining qoidalari')),
    el('p',{class:'text-sm text-ink-500'},text('Presentation changes apply to future feedback after approval. Scores, answer keys and access rules remain protected.',
      'Izoh uslubi tasdiqdan keyingi natijalarga qo‘llanadi. Ball, javob kaliti va kirish qoidalari himoyalangan.')),
    scope,style,count,el('div',{class:'flex gap-2'},preview,save),message,list);
  renderItems(items);return host;
}

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
  load: async () => {
    const [diagnostics,policies]=await Promise.all([RiwiClientAdapter.getOwnerDiagnostics(),RiwiClientAdapter.getAssessmentPolicies()]);
    return {...diagnostics,assessmentPolicies:policies.items||[]};
  },
  render(ctx, data) {
    const locale = ctx.locale === 'en' ? 'en' : 'uz';
    const providers = Array.isArray(data?.providers) ? data.providers : [];
    return el('div', {class: 'mx-auto flex max-w-4xl flex-col gap-6', 'data-owner-riwi': ''},
      heading(tRiwi('riwi.owner.title', locale), tRiwi('riwi.subtitle.owner', locale)),
      el('p',{class:'card p-4 text-sm text-ink-900',role:'status'},locale==='en'
        ? 'NO-GO: mandatory acceptance evidence remains incomplete.'
        : 'NO-GO: majburiy tekshiruv dalillari hali to‘liq emas.'),
      el('section', {class: 'card p-5 flex flex-col gap-3'},
        el('h2', {class: 'font-display text-lg text-ink-900'}, tRiwi('riwi.owner.tab.diagnostics', locale)),
        el('p', {class: 'text-sm text-ink-500'}, `Rollout enabled: ${Boolean(data?.rollout?.enabled)}`),
        el('div', {class: 'grid gap-2'},
          ...providers.map((p) =>
            el('div', {class: 'flex items-center justify-between text-sm text-ink-900', 'data-provider-id': p.id},
              el('span', {class: 'font-medium'}, p.displayName || p.id),
              el('span', {class: 'text-ink-500'}, p.secretsPresent ? (locale==='en'?'Configured':'Sozlangan') : (locale==='en'?'Unconfigured':'Sozlanmagan'))
            )
          )
        )
      ),
      assessmentPolicyPanel(ctx,data?.assessmentPolicies||[])
    );
  }
});
