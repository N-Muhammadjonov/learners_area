"""Canonical lexical ingestion for staff-authored TED and Podcast lessons.

Python translation of lexical/reading-occurrences.ts, listening-occurrences.ts,
forms.ts and units.ts. Every candidate occurrence is grounded in a real string
span; ambiguity never guesses a sense.
"""
from __future__ import annotations
import json,re,unicodedata
from pathlib import Path
from .step21_vocab_batch import sense_key,normalize_term,normalize_pos
RULES=json.loads((Path(__file__).parent/'video_lexical_rules.json').read_text())
WORD=re.compile(r"[A-Za-z0-9'\-]")

def normalize_lex(s):
    return re.sub(r'\s+',' ',re.sub('[’‘ʼʻ`´′]', "'",unicodedata.normalize('NFKC',str(s)).lower())).strip()

def lexical_type(word,pos):
    by={'noun phrase':'noun_phrase','verb phrase':'verb_phrase','phrasal verb':'phrasal_verb','idiom':'idiom','collocation':'collocation','fixed expression':'fixed_expression','compound':'compound'}
    return by.get(pos,'phrase' if ' ' in normalize_lex(word) else 'word')

def is_function(word):return ' ' not in normalize_lex(word) and normalize_lex(word) in RULES['functionWords']

def forms_of(term,pos):
    lemma=normalize_lex(term);pos=normalize_pos(pos)
    pos=re.sub(r'^\((.*)\)$',r'\1',unicodedata.normalize('NFKC',pos)).removesuffix('.')
    pos={'n':'noun','v':'verb','adj':'adjective','adv':'adverb','phr':'phrase','prep':'preposition','n.phrase':'noun phrase','v.phrase':'verb phrase'}.get(pos,pos)
    found={}
    def add(form,kind):
        norm=normalize_lex(form)
        if norm:found.setdefault(norm,(form,norm,kind))
    add(lemma,'lemma')
    if not lemma or re.search(r"[^a-z' -]",lemma):return list(found.values())
    words=lemma.split(' ');head=words[0];tail=' '.join(words[1:]);join=lambda first:first+(' '+tail if tail else '')
    verbal=pos in ('verb','auxiliary verb') or lexical_type(lemma,pos) in ('verb_phrase','phrasal_verb')
    if verbal:
        third=(head+'es' if re.search(r'(s|x|z|ch|sh|o)$',head) else head[:-1]+'ies' if re.search(r'[^aeiou]y$',head) else head+'s')
        syllables=len(re.findall(r'[aeiouy]+',head))
        doubled=syllables==1 and bool(re.search(r'[^aeiou][aeiou][^aeiouwxy]$',head))
        ing=(head[:-2]+'ying' if head.endswith('ie') else head[:-1]+'ing' if re.search(r'[^aeiou]e$',head) and head!='be' and len(head)>2 else head+head[-1]+'ing' if doubled else head+'ing')
        add(join(third),'regular');add(join(ing),'regular')
        if head in RULES['verbs']:
            for form in RULES['verbs'][head]:add(join(form),'irregular')
        elif re.search(r'[aeiou]',head):
            past=head+'d' if head.endswith('e') else head[:-1]+'ied' if re.search(r'[^aeiou]y$',head) else head+head[-1]+'ed' if doubled else head+'ed'
            add(join(past),'regular')
    elif pos=='noun' and len(words)==1:
        irr=RULES['nouns'].get(lemma)
        pl=irr or (lemma+'es' if re.search(r'(s|x|z|ch|sh)$',lemma) else lemma[:-1]+'ies' if re.search(r'[^aeiou]y$',lemma) else lemma+'s')
        add(pl,'irregular' if irr else 'regular')
    elif pos in ('adjective','a') and len(words)==1:
        for x in RULES['adjectives'].get(lemma,[]):add(x,'regular')
    elif pos in ('adverb','r') and len(words)==1:
        for x in RULES['adverbs'].get(lemma,[]):add(x,'regular')
    return list(found.values())

async def sense_for(con,entry):
    key=sense_key({'term':entry['word'],'partOfSpeech':entry['pos'],'definitionEn':entry['def']})
    rows=await con.fetch('''SELECT * FROM lexemes WHERE sense_key=$1 OR term=$2 OR term=$3''',key,entry['word'].strip(),entry['word'].strip().lower())
    sense=next((r for r in rows if r['sense_key']==key or sense_key({'term':r['term'],'partOfSpeech':r['part_of_speech'],'definitionEn':r['definition_en']})==key),None)
    if sense:return sense
    await con.execute('''INSERT INTO lexemes(term,part_of_speech,definition_en,translation_uz,example_sentence,sense_key,
         provenance,verification_status,import_batch) VALUES($1,$2,$3,$4,$5,$6,'video_authoring','unverified',$7)
         ON CONFLICT(sense_key) DO NOTHING''',entry['word'].strip(),entry['pos'].strip() or None,entry['def'].strip(),entry['uz'].strip() or None,
        entry['ex'].strip() or None,key,f'video_authoring:{entry["sourceId"]}'[:80])
    return await con.fetchrow('SELECT * FROM lexemes WHERE sense_key=$1',key)

async def linked_unit(con,sense):
    if sense['lexical_unit_id']:return sense['lexical_unit_id']
    term=sense['term'];pos=normalize_pos(sense['part_of_speech']);type_=lexical_type(term,pos);norm=normalize_lex(term)[:120]
    await con.execute('''INSERT INTO lexical_units(language,lemma,lemma_norm,part_of_speech,lexical_type,is_function_word,provenance)
         VALUES('en',$1,$2,$3,$4,$5,'video_authoring') ON CONFLICT(language,lemma_norm,part_of_speech,lexical_type)
         DO NOTHING''',term.strip()[:120],norm,pos[:30],type_,is_function(term))
    unit=await con.fetchrow('''SELECT id FROM lexical_units WHERE language='en' AND lemma_norm=$1 AND part_of_speech=$2 AND lexical_type=$3''',norm,pos[:30],type_)
    unit_id=unit['id']
    for form,norm,kind in forms_of(term,sense['part_of_speech']):
        await con.execute('''INSERT INTO lexical_unit_forms(lexical_unit_id,form,form_norm,form_type)
            VALUES($1,$2,$3,$4) ON CONFLICT(lexical_unit_id,form_norm) DO NOTHING''',unit_id,form[:160],norm[:160],kind)
    await con.execute('UPDATE lexemes SET lexical_unit_id=$2 WHERE id=$1 AND lexical_unit_id IS NULL',sense['id'],unit_id)
    return unit_id

def spans(body,candidates):
    folded=normalize_lex_apostrophes(body)
    groups={}
    for c in candidates:
        for form in c['forms']:
            key=normalize_lex_apostrophes(form.strip());key=re.sub(r'\s+',' ',key)
            if key:groups.setdefault(key,set()).add(c['key'])
    taken=[False]*len(body);out=[]
    for form in sorted(groups,key=len,reverse=True):
        rx=re.compile(r'\s+'.join(re.escape(v) for v in form.split(' ')))
        for m in rx.finditer(folded):
            left,right=m.span()
            if left>0 and WORD.fullmatch(folded[left-1]) or right<len(folded) and WORD.fullmatch(folded[right]):continue
            if any(taken[left:right]):continue
            taken[left:right]=[True]*(right-left)
            out.append({'keys':list(groups[form]),'start':left,'end':right,'surface':body[left:right]})
    return sorted(out,key=lambda x:x['start'])

def normalize_lex_apostrophes(s):return s.lower().replace('’',"'").replace('‘',"'").replace('`',"'")

def sentence_at(body,start,end):
    left=max(body.rfind(x,0,start) for x in '.?!\n')
    stops=[i for x in '.?!\n' if (i:=body.find(x,end))>=0]
    right=min(stops)+1 if stops else len(body)
    sentence=body[left+1:right].strip()
    return sentence if len(sentence)<=600 else body[max(0,start-160):end+160].strip()

def comparable(s):return re.sub(r'\s+',' ',re.sub(r"[^a-z0-9' ]+",' ',normalize_lex(s))).strip()
def example_matches(example,sentence):
    a,b=comparable(example),comparable(sentence)
    return bool(a and b and (a in b or b in a))

async def occurrence(con,vid,span,linked,unit_id,sentence,kind,source):
    await con.execute('''INSERT INTO lexical_occurrences(source_type,video_lesson_id,lexeme_id,lexical_unit_id,segment_key,
          surface_form,start_char,end_char,sentence_text,occurrence_type,is_target_vocabulary,resolution_status,resolution_source)
          VALUES('video',$1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11) ON CONFLICT DO NOTHING''',vid,
          linked['lexeme'] if linked else None,unit_id,span.get('segmentKey'),span['surface'][:120],span['start'],span['end'],
          sentence,kind,'resolved' if linked else 'unresolved',source if linked else None)

async def ingest_video_occurrences(con,video_id,body,vocabulary):
    senses={};candidates=[]
    for data in vocabulary:
        entry={**data,'sourceId':str(video_id)}
        if is_function(data['word']):continue
        key=sense_key({'term':data['word'],'partOfSpeech':data['pos'],'definitionEn':data['def']})
        if key in senses:continue
        sense=await sense_for(con,entry)
        if not sense:continue
        unit_id=await linked_unit(con,sense)
        senses[key]={'lexeme':sense['id'],'unit':unit_id,'example':data['ex']}
        candidates.append({'key':key,'forms':[f[0] for f in forms_of(data['word'],data['pos'])]})
    authored=[]
    for data in vocabulary:
        key=sense_key({'term':data['word'],'partOfSpeech':data['pos'],'definitionEn':data['def']})
        if key not in senses:continue
        for surface in data.get('surfaces',[]):
            search=0
            while surface:
                at=body.find(surface,search)
                if at<0:break
                end=at+len(surface)
                if not any(at<other['end'] and end>other['start'] for other in authored):
                    authored.append({'keys':[key],'start':at,'end':end,'surface':surface})
                search=end
    matched=[v for v in spans(body,candidates) if not any(v['start']<a['end'] and v['end']>a['start'] for a in authored)]
    for span in sorted(authored+matched,key=lambda x:x['start']):
        sentence=sentence_at(body,span['start'],span['end'])
        checked=[k for k in span['keys'] if example_matches(senses[k]['example'],sentence)]
        linked=senses[checked[0]] if len(checked)==1 else None
        ids={senses[k]['unit'] for k in span['keys']}
        unit=next(iter(ids)) if len(ids)==1 else None
        await occurrence(con,video_id,span,linked,unit,sentence,'vocabulary','video_authoring')
    for data in vocabulary:
        entry={**data,'sourceId':str(video_id)}
        sense=await sense_for(con,entry)
        if not sense:raise RuntimeError('authored_video_sense_missing')
        present=await con.fetchval("SELECT id FROM lexical_occurrences WHERE video_lesson_id=$1 AND lexeme_id=$2 AND resolution_status='resolved' LIMIT 1",video_id,sense['id'])
        if present:continue
        unit=await linked_unit(con,sense)
        word=data['word'].strip()
        await occurrence(con,video_id,{'surface':word,'start':0,'end':len(word),'segmentKey':'v:'+str(sense['id'])},
                         {'lexeme':sense['id']},unit,data['ex'].strip() or None,'authored_vocabulary','video_authoring')
