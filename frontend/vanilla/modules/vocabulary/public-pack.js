/** Owner-only public topic-pack publication. Server checks authority and content. */
import {h} from '../../js/native.js';
import {request} from './shared.js';

const FIELDS = ['term','partOfSpeech','definitionEn','translationUz','example','collocations'];

export function parsePackWords(source) {
  const text = String(source ?? '').trim();
  if (!text) throw Error('empty_words');
  let entries;
  if (text.startsWith('[')) {
    entries = JSON.parse(text);
  } else {
    entries = text.split(/\r?\n/).filter(line=>line.trim()).map(line=>{
      const cells = line.includes('\t') ? line.split('\t') : line.split('|');
      if (cells.length < 5 || cells.length > 6) throw Error('invalid_columns');
      return Object.fromEntries(FIELDS.map((field,index)=>[field,(cells[index]??'').trim()]));
    });
  }
  if (!Array.isArray(entries) || entries.length < 5 || entries.length > 300)
    throw Error('invalid_count');
  const senses = new Set();
  return entries.map(item=>{
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw Error('invalid_item');
    const row = Object.fromEntries(FIELDS.map(field=>[field,String(item[field]??'').trim()]));
    for (const key of ['term','definitionEn','translationUz','example']) {
      if (!row[key]) throw Error('missing_'+key);
    }
    const identity=[row.term.toLowerCase(),row.partOfSpeech.toLowerCase(),row.definitionEn.toLowerCase()].join('|');
    if (senses.has(identity)) throw Error('duplicate_word');
    senses.add(identity);
    return row;
  });
}

export function mountPublicPack(ctx, host) {
  if (ctx.session?.user?.role !== 'owner') return;
  const uz=ctx.locale==='uz';
  const card=h('section',{class:'card flex flex-col gap-3 p-4','data-public-pack-publisher':''});
  const label=(uzText,enText)=>uz?uzText:enText;
  const slug=h('input',{type:'text',required:true,maxLength:60,pattern:'[a-z0-9][a-z0-9_-]{1,59}',
    placeholder:'climate_change','aria-label':label('Pack identifikatori','Pack slug'),
    class:'w-full min-w-0 rounded-lg border border-ink-100 bg-paper-raised p-2 text-ink-900'});
  const titleEn=h('input',{type:'text',required:true,maxLength:120,placeholder:'Climate change',
    'aria-label':label('Inglizcha nom','English title'),
    class:'w-full min-w-0 rounded-lg border border-ink-100 bg-paper-raised p-2 text-ink-900'});
  const titleUz=h('input',{type:'text',required:true,maxLength:120,placeholder:'Iqlim o‘zgarishi',
    'aria-label':label('O‘zbekcha nom','Uzbek title'),
    class:'w-full min-w-0 rounded-lg border border-ink-100 bg-paper-raised p-2 text-ink-900'});
  const content=h('textarea',{rows:7,required:true,
    class:'w-full min-w-0 rounded-lg border border-ink-100 bg-paper-raised p-3 font-mono text-xs text-ink-900',
    placeholder:label('term | noun | English definition | o‘zbekcha tarjima | Example sentence',
                      'term | noun | English definition | Uzbek translation | Example sentence'),
    'aria-label':label('So‘zlar ro‘yxati','Vocabulary words')});
  const message=h('p',{role:'status','aria-live':'polite',class:'text-sm text-ink-500'});
  const submit=h('button',{type:'submit',class:'btn-primary',
    'data-publish-public-pack':''},label('Public packni nashr qilish','Publish public pack'));
  const controls=h('div',{class:'grid gap-2 sm:grid-cols-3'},
    h('label',{class:'flex min-w-0 flex-col gap-1 text-xs text-ink-500'},
      label('Identifikator','Slug'),slug),
    h('label',{class:'flex min-w-0 flex-col gap-1 text-xs text-ink-500'},
      label('Inglizcha nom','English title'),titleEn),
    h('label',{class:'flex min-w-0 flex-col gap-1 text-xs text-ink-500'},
      label('O‘zbekcha nom','Uzbek title'),titleUz));
  let busy=false;
  const form=h('form',{class:'flex flex-col gap-3',onSubmit:async event=>{
    event.preventDefault();
    if (busy || ctx.signal.aborted) return;
    let words;
    try {words=parsePackWords(content.value);}
    catch {
      message.textContent=label('Har qatorda 5–6 ta ustun va kamida 5 ta so‘z bo‘lsin. JSON array ham qabul qilinadi.',
                                'Use 5–6 columns per line and at least 5 words, or a JSON array.');
      return;
    }
    busy=true;submit.disabled=true;
    message.textContent=label('Tekshirilmoqda…','Validating…');
    try {
      const result=await request('/api/vocabulary/packs/public',{
        method:'POST',body:{slug:slug.value.trim(),labelEn:titleEn.value.trim(),
          labelUz:titleUz.value.trim(),words},signal:ctx.signal});
      if (ctx.signal.aborted) return;
      message.textContent=label(
        'Public pack nashr qilindi ('+result.pack.wordCount+' so‘z). Rejaning kelajakdagi kunlariga kiritish uchun rejani qayta tuzing.',
        'Public pack published ('+result.pack.wordCount+' words). Regenerate future plan days to include it.');
      content.value='';
      window.dispatchEvent(new Event('vocab:packs-changed'));
    } catch (error) {
      if (ctx.signal.aborted) return;
      message.textContent=error?.code==='pack_already_exists'
        ?label('Bunday identifikatorli pack allaqachon mavjud.','This pack slug already exists.')
        :label('Nashr qilinmadi. Format va tarjimalarni tekshiring.','Publication failed. Check the input and translations.');
    } finally {
      busy=false;submit.disabled=false;
    }
  }},
    controls,
    h('label',{class:'flex flex-col gap-1 text-xs text-ink-500'},
      label('So‘zlar: TSV, | bilan ajratilgan qatorlar yoki JSON ro‘yxat',
            'Words: TSV, pipe-delimited lines or JSON array'),content),
    h('p',{class:'text-xs text-ink-500'},
      label('Ustunlar: term | partOfSpeech | definitionEn | translationUz | example | collocations (ixtiyoriy).',
            'Columns: term | partOfSpeech | definitionEn | translationUz | example | collocations (optional).')),
    h('div',{class:'flex flex-wrap items-center gap-3'},submit,message));
  card.append(h('h2',{class:'text-base font-semibold text-ink-900'},
    label('Public Topic Pack — Owner','Public Topic Pack — Owner')),form);
  host.append(card);
}
