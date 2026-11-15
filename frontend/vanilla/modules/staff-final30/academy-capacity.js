import {api} from '../../js/api-client.js';
import {BackLink, el, listen} from './kit.js';

const route = '/api/staff/academy';
const fields = [
  ['projectedStudents', 'Projected learners', 'Kutilgan o‘quvchilar', 1000],
  ['tuitionMinor', 'Tuition per learner (UZS)', 'Bir o‘quvchi to‘lovi (UZS)', 'money'],
  ['discountBps', 'Discount (%)', 'Chegirma (%)', 'percent'],
  ['collectionBps', 'Expected collection (%)', 'Kutilgan undirish (%)', 'percent'],
  ['cashWithinPeriodBps', 'Collection within the period (%)', 'Shu davrda tushadigan ulush (%)', 'percent'],
  ['deliveryBps', 'Earned portion of tuition (%)', 'Xizmati ko‘rsatilgan to‘lov ulushi (%)', 'percent'],
  ['openingDebtMinor', 'Prior debt (UZS)', 'Oldingi qarz (UZS)', 'money'],
  ['debtRecoveryBps', 'Prior debt collected in the period (%)', 'Shu davrda undiriladigan oldingi qarz (%)', 'percent'],
  ['teacherRateMinor', 'Teacher rate (UZS)', 'O‘qituvchi tarifi (UZS)', 'money'],
  ['teacherFixedMinor', 'Hybrid fixed portion (UZS)', 'Aralash usulning qat’iy qismi (UZS)', 'money'],
  ['teacherRevenueBps', 'Teacher share of earned tuition (%)', 'O‘qituvchining ishlab topilgan to‘lovdagi ulushi (%)', 'percent'],
  ['teacherMinutesAvailable', 'Teacher minutes available', 'O‘qituvchilarning bo‘sh daqiqalari', 52560],
];
const methods = [
  ['fixed', 'Fixed for the period', 'Davr uchun qat’iy'],
  ['per_session', 'Per session', 'Darsbay'],
  ['hourly', 'Hourly', 'Soatbay'],
  ['revenue_share', 'Revenue share', 'Tushum ulushi'],
  ['hybrid', 'Fixed and hourly', 'Qat’iy va soatbay'],
];
const metrics = [
  ['billableStudents', 'Learners within capacity', 'Sig‘imga mos o‘quvchilar'],
  ['studentsOverCapacity', 'Learners without seats', 'Joy yetmaydigan o‘quvchilar'],
  ['seatUseBps', 'Seat usage (%)', 'Band joylar (%)'],
  ['invoicedMinor', 'Projected tuition billed', 'Hisoblanadigan o‘qish to‘lovi'],
  ['recognizedMinor', 'Projected earned tuition', 'Ishlab topiladigan o‘qish daromadi'],
  ['cashFromTuitionMinor', 'Tuition cash in period', 'Shu davrda tushadigan o‘qish to‘lovi'],
  ['cashFromOpeningDebtMinor', 'Cash from prior debt', 'Oldingi qarzdan tushum'],
  ['cashTotalMinor', 'Total cash in period', 'Davrdagi jami pul tushumi'],
  ['unpaidTuitionMinor', 'Projected unpaid tuition', 'Undirilmay qolishi kutilgan to‘lov'],
  ['teacherCostMinor', 'Teacher cost', 'O‘qituvchi xarajati'],
  ['contributionMinor', 'Earned tuition less teacher cost', 'Daromaddan o‘qituvchi xarajati ayirilganda'],
];

function percentage(value) {
  const [whole, fraction = ''] = value.split(/[.,]/);
  return Number(whole)*100 + Number(fraction.padEnd(2, '0'));
}

function formatMinor(value, locale) {
  return new Intl.NumberFormat(locale).format(BigInt(value))+' UZS';
}

export async function mount(ctx) {
  const uz = ctx.locale === 'uz';
  const tr = (en, translated) => uz ? translated : en;
  const selectedLabel = parts => parts[uz ? 2 : 1];
  const request = (path, options = {}) => api.request(route+path, {...options, signal:ctx.signal, fresh:true});
  if (ctx.session.user.role !== 'owner') {
    void ctx.navigate('/app/management', {replace:true});
    return;
  }
  const host = el('section', {class:'mx-auto max-w-6xl space-y-4', 'data-academy-capacity':''});
  const choices = el('div', {class:'space-y-2'});
  const formRegion = el('div');
  const results = el('div', {'aria-live':'polite'});
  host.append(
    BackLink({fallbackHref:'/app/management', label:ctx.dict.common.back}),
    el('h1', {class:'font-display text-2xl'}, tr('Capacity and revenue explorer', 'Sig‘im va daromad tahlili')),
    el('p', {}, tr('Simulate one proposed lesson and one tuition forecast period. The rates and collections are your assumptions.',
                   'Bitta dars va bitta to‘lov davri uchun hisoblang. Tarif va tushumlar siz kiritgan farazlarga asoslanadi.')),
    choices, formRegion, results,
  );
  ctx.root.append(host);
  const group = el('select', {required:true, 'data-capacity-group':''});
  const loadButton = el('button', {type:'submit', class:'btn-secondary'}, tr('Load group', 'Guruhni ochish'));
  const find = el('form', {}, el('label', {}, tr('Active group', 'Faol guruh'), group), ' ', loadButton);
  const more = el('button', {type:'button', class:'btn-secondary'}, tr('More groups', 'Yana guruhlar'));
  const error = el('p', {role:'alert'});
  choices.append(find, more, error);
  let page = 1;

  async function loadGroups() {
    more.disabled = true;
    error.textContent = '';
    try {
      const response = await request('/groups?status=active&page='+page);
      if (ctx.signal.aborted) return;
      group.append(...response.groups.map(item => el('option', {value:item.id}, item.name+' · '+item.branch)));
      more.hidden = !response.hasNext;
      loadButton.disabled = !group.options.length;
      if (!group.options.length) error.textContent = tr('Create an active group first.', 'Avval faol guruh yarating.');
      page++;
    } catch {
      if (!ctx.signal.aborted) error.textContent = ctx.dict.common.error;
    } finally {
      more.disabled = false;
    }
  }

  function report(value) {
    const captions = [tr('Optimistic', 'Ijobiy'), tr('Neutral', 'Asosiy'), tr('Stress', 'Salbiy')];
    const locale = uz ? 'uz-UZ' : 'en-GB';
    const table = el('table', {class:'w-full text-left'},
      el('caption', {}, tr('Simulated values', 'Simulyatsiya natijalari')),
      el('thead', {}, el('tr', {}, el('th', {scope:'col'}, tr('Measure', 'Ko‘rsatkich')),
        ...captions.map(caption => el('th', {scope:'col', class:'p-2'}, caption)))),
      el('tbody', {}, ...metrics.map(metric => {
        const key = metric[0];
        return el('tr', {}, el('th', {scope:'row', class:'p-2'}, selectedLabel(metric)),
          ...value.scenarios.map(item => el('td', {class:'p-2'}, key.endsWith('Minor')
            ? formatMinor(item[key], locale) : key.endsWith('Bps') ? item[key]/100 : item[key])));
      })),
    );
    const actuals = value.academyActuals;
    const actualRows = [
      ['invoicedTuitionMinor', 'Tuition billed', 'Hisoblangan to‘lov'],
      ['collectedNetMinor', 'Net cash collected', 'Sof pul tushumi'],
      ['recognizedRevenueMinor', 'Recognized revenue', 'Tan olingan daromad'],
      ['outstandingReceivableMinor', 'Current receivables', 'Joriy qarzdorlik'],
      ['overdueReceivableMinor', 'Current overdue receivables', 'Muddati o‘tgan joriy qarz'],
    ];
    const conflictLabels = {
      group:tr('Group', 'Guruh'), room:tr('Room', 'Xona'), teacher:tr('Teacher', 'O‘qituvchi'),
    };
    const conflicts = value.schedule.conflicts.map(key => conflictLabels[key]).join(', ');
    results.replaceChildren(
      el('p', {}, value.schedule.feasible ? tr('Slot is available.', 'Tanlangan vaqt bo‘sh.')
        : tr('Slot is unavailable.', 'Tanlangan vaqt band yoki o‘qituvchi soati yetmaydi.')),
      conflicts ? el('p', {}, tr('Schedule conflicts', 'Jadvaldagi to‘qnashuvlar')+' · '+conflicts) : null,
      el('p', {}, tr('Teaching minutes required', 'Kerakli o‘qituvchi daqiqalari')+' · '+value.schedule.teacherMinutesRequired),
      el('p', {}, tr('Teaching minutes missing', 'Yetishmayotgan o‘qituvchi daqiqalari')+' · '+value.schedule.staffingGapMinutes),
      el('p', {}, tr('Optimistic and stress scenarios vary projected learners by 10% and collection by 10 percentage points.',
                       'Ijobiy va salbiy ssenariylarda o‘quvchi soni 10%, undirish ulushi 10 foiz punktiga o‘zgaradi.')),
      el('div', {class:'overflow-x-auto'}, table),
      el('h2', {class:'font-display text-xl'}, tr('Academy ledger', 'Akademiya hisob jurnali')),
      el('p', {}, actuals.range.start+' – '+actuals.range.end),
      el('dl', {class:'grid gap-2 sm:grid-cols-2'}, ...actualRows.map(metric =>
        el('div', {}, el('dt', {}, selectedLabel(metric)), el('dd', {}, formatMinor(actuals[metric[0]], locale))))),
    );
  }

  function simulation(snapshot) {
    const projected = new Map([['projectedStudents',snapshot.reservedSeats],['openingDebtMinor','0'],['debtRecoveryBps','0']]);
    const controls = {};
    const input = (key, label, attrs) => {
      const node = el('input', {name:key, class:'input min-w-0', required:true, ...attrs});
      controls[key] = node;
      return el('div', {}, el('label', {class:'grid gap-1'}, label, node));
    };
    const method = el('select', {name:'teacherPayMethod', class:'input'},
      ...methods.map(([value,en,translated]) => el('option', {value}, tr(en,translated))));
    const form = el('form', {class:'space-y-3', 'data-capacity-simulation':''},
      el('p', {}, snapshot.groupName+' · '+tr('Reserved seats', 'Band joylar')+' '+snapshot.reservedSeats+'/'+snapshot.capacity),
      el('div', {class:'grid gap-3 sm:grid-cols-2 lg:grid-cols-3'},
        ...fields.map(field => {
          const [key,,,kind] = field;
          const value = projected.get(key) ?? '';
          const hints = kind === 'money' ? {type:'text', inputmode:'numeric', pattern:'[0-9]{1,17}', maxlength:17}
            : kind === 'percent' ? {type:'text', inputmode:'decimal', pattern:'[0-9]{1,3}([.,][0-9]{1,2})?', maxlength:6}
              : {type:'number', min:0, max:kind, step:1};
          return input(key, selectedLabel(field), {...hints, value});
        }),
        el('label', {class:'grid gap-1'}, tr('Teacher pay basis', 'O‘qituvchi to‘lovi usuli'), method),
        input('localDate', tr('Date', 'Sana'), {type:'date', min:snapshot.today, value:snapshot.today}),
        input('localStart', tr('Start time', 'Boshlanish vaqti'), {type:'time'}),
        input('durationMinutes', tr('Lesson minutes', 'Dars davomiyligi (daqiqa)'), {type:'number', min:15, max:360, value:60}),
        input('room', tr('Room', 'Xona'), {type:'text', maxlength:120, value:snapshot.room ?? ''}),
      ));
    const submit = el('button', {type:'submit', class:'btn-primary'}, tr('Calculate scenarios', 'Ssenariylarni hisoblash'));
    const failure = el('p', {role:'alert'});
    form.append(submit, failure);
    function adjustPayInputs() {
      for (const [key, enabled] of [
        ['teacherRateMinor',method.value !== 'revenue_share'],
        ['teacherFixedMinor',method.value === 'hybrid'],
        ['teacherRevenueBps',method.value === 'revenue_share'],
      ]) {
        controls[key].disabled = !enabled;
        controls[key].parentElement.parentElement.hidden = !enabled;
      }
    }
    listen(method, 'change', adjustPayInputs, ctx.signal);
    adjustPayInputs();
    listen(form, 'submit', async event => {
      event.preventDefault();
      if (submit.disabled || !form.reportValidity()) return;
      submit.disabled = true;
      failure.textContent = '';
      results.replaceChildren();
      const values = Object.fromEntries(fields.map(([key,,,kind]) => {
        const node = controls[key];
        const value = node.disabled ? '0' : node.value;
        return [key, kind === 'money' ? value : kind === 'percent' ? percentage(value) : Number(value)];
      }));
      const body = {...values, teacherPayMethod:method.value, slot:{
        localDate:controls.localDate.value, localStart:controls.localStart.value,
        durationMinutes:controls.durationMinutes.valueAsNumber, room:controls.room.value,
      }};
      try {
        const response = await request('/capacity/'+encodeURIComponent(snapshot.groupId), {method:'POST', body});
        if (!ctx.signal.aborted && form.isConnected) report(response);
      } catch (problem) {
        if (!ctx.signal.aborted) failure.textContent = problem.code === 'invalid_session_window'
          ? tr('Pick a date within the active group schedule.', 'Faol guruh muddatiga mos sanani tanlang.')
          : ctx.dict.common.error;
      } finally {
        submit.disabled = false;
      }
    }, ctx.signal);
    formRegion.replaceChildren(form);
  }

  listen(more, 'click', () => void loadGroups(), ctx.signal);
  listen(find, 'submit', async event => {
    event.preventDefault();
    if (loadButton.disabled || !group.value) return;
    loadButton.disabled = true;
    error.textContent = '';
    formRegion.replaceChildren();
    results.replaceChildren();
    try {
      const snapshot = await request('/capacity/'+encodeURIComponent(group.value));
      if (!ctx.signal.aborted) simulation(snapshot);
    } catch {
      if (!ctx.signal.aborted) error.textContent = ctx.dict.common.error;
    } finally {
      loadButton.disabled = false;
    }
  }, ctx.signal);
  loadButton.disabled = true;
  await loadGroups();
}
