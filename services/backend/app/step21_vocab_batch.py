"""Vocabulary batch saving, maintaining user locking, canonical senses and dedup.
Source: lib/services/vocabulary/engine.ts addVocabularyBatch / dedupe.ts.
"""
from __future__ import annotations
import hashlib,json,re,unicodedata
from .db import row_to_dict


from .js_text import collapse,trim,slice as js_slice

def fold(s):return re.sub('[\u2018\u2019\u02bc\u02bb`´′]',"'",str(s))
def normalize_term(s):return trim(re.sub(r'^(a|an|the)\s+','',trim(collapse(fold(s.lower())))))
def normalize_pos(s):
    raw=re.sub(r'^\((.*)\)$',r'\1',trim(unicodedata.normalize('NFKC',s or '').lower())).removesuffix('.')
    aliases={'n':'noun','v':'verb','adj':'adjective','adv':'adverb','phr':'phrase','prep':'preposition','n.phrase':'noun phrase','v.phrase':'verb phrase'}
    return aliases.get(raw,collapse(raw))
def normalize_meaning(s):return trim(re.sub(r'\.$','',trim(collapse(unicodedata.normalize('NFKC',s or '').lower()))))
def legacy_sense_key(item):
    raw=trim((item.get('partOfSpeech') or '').lower());pos=None
    for pattern,value in [('n|noun','noun'),('v|verb','verb'),('adj|adjective','adjective'),('adv|adverb','adverb'),('phr|phrase|idiom|expression','phrase'),('prep|preposition','preposition')]:
        if re.match('^('+pattern+')',raw):pos=value;break
    if pos is None:pos=re.sub('[^a-z]+','',raw)[:20]
    meaning=re.split(r'[;,.(\n]',(item.get('definitionEn') or '').lower())[0]
    return js_slice('|'.join(part for part in [normalize_term(item['term']),pos,meaning] if part),0,200)
def sense_key(item):
    parts=[normalize_term(item['term']),normalize_pos(item.get('partOfSpeech')),normalize_meaning(item.get('definitionEn'))]
    return 'v2:'+hashlib.sha256(json.dumps(parts,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

async def add_batch(con,user_id,items,*,topic_pack=None,source_type='manual',source_id=None,folder_id=None):
    """Called inside a transaction. Returns original engine result shape."""
    await con.fetchrow('SELECT id FROM users WHERE id=$1 FOR UPDATE',user_id)
    if folder_id:
        if not await con.fetchval('SELECT id FROM vocab_folders WHERE id=$1 AND user_id=$2',folder_id,user_id):
            return {'ok':False,'error':'folder_not_found'}
    if not folder_id and source_type=='video':
        title=await con.fetchval('SELECT title FROM video_lessons WHERE id=$1',source_id)
        if not title:return {'ok':False,'error':'source_not_found'}
        folder_id=await con.fetchval('''INSERT INTO vocab_folders(user_id,name) VALUES($1,$2)
           ON CONFLICT(user_id,name) DO UPDATE SET name=excluded.name RETURNING id''',user_id,'TED : '+title)
    if not folder_id and source_type in ('reading','listening','retention'):
        name=source_type.capitalize()
        folder_id=await con.fetchval('''INSERT INTO vocab_folders(user_id,name) VALUES($1,$2)
           ON CONFLICT(user_id,name) DO UPDATE SET name=excluded.name RETURNING id''',user_id,name)
    collapsed={}
    for w in items:
        k=str(w.get('canonicalLexemeId') or sense_key(w))
        if k not in collapsed:collapsed[k]=w
    existing=await con.fetch('SELECT id,lexeme_id,sense_key FROM user_vocabulary WHERE user_id=$1',user_id)
    known_senses={r['sense_key']:str(r['id']) for r in existing if r['sense_key']}
    known_lexemes={str(r['lexeme_id']):str(r['id']) for r in existing}
    count=0;ids=[]
    for item in collapsed.values():
        key=sense_key(item)
        if item.get('canonicalLexemeId'):
            lexeme=await con.fetchrow('SELECT * FROM lexemes WHERE id=$1',item['canonicalLexemeId'])
            if lexeme is None:return {'ok':False,'error':'lexeme_not_found'}
            key=lexeme['sense_key']
        else:
            lexeme=await con.fetchrow('''SELECT * FROM lexemes WHERE sense_key=$1
                 OR (lower(term)=$2 AND lower(coalesce(part_of_speech,''))=$3 AND lower(definition_en)=$4)
                 ORDER BY CASE WHEN sense_key=$1 THEN 0 ELSE 1 END LIMIT 1''',
                 key,normalize_term(item['term']),normalize_pos(item.get('partOfSpeech')),item['definitionEn'].lower())
        existing_id=known_lexemes.get(str(lexeme['id'])) if lexeme else None
        existing_id=existing_id or known_senses.get(key)
        if existing_id:
            if source_type=='video' and folder_id:
                await con.execute('''UPDATE user_vocabulary SET folder_id=$3
                  WHERE user_id=$1 AND id=$2 AND folder_id IS NULL''',user_id,existing_id,folder_id)
            ids.append(existing_id)
            continue
        if lexeme is None:
            lexeme=await con.fetchrow('''INSERT INTO lexemes(term,part_of_speech,definition_en,translation_uz,example_sentence,
               collocations,accepted_translations,sense_key,provenance,verification_status)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(sense_key) DO UPDATE
               SET sense_key=excluded.sense_key RETURNING *''',normalize_term(item['term']),item.get('partOfSpeech'),item['definitionEn'],
               item.get('translationUz'),item.get('exampleSentence'),item.get('collocations'),
               [a.strip() for a in item.get('acceptedTranslations',[]) if isinstance(a,str) and a.strip()][:4],key,
               'authored' if item.get('authored') else 'user_provided','verified' if item.get('authored') else 'unverified')
        # The identity must be available before creating the user vocabulary item.
        if not lexeme['lexical_unit_id']:
            normalized=normalize_term(lexeme['term'])[:120]
            pos=normalize_pos(lexeme['part_of_speech'])[:30]
            typ='word' if ' ' not in lexeme['term'] else 'phrase'
            unit=await con.fetchval('''INSERT INTO lexical_units(lemma,lemma_norm,part_of_speech,lexical_type,provenance)
              VALUES($1,$2,$3,$4,$5) ON CONFLICT(language,lemma_norm,part_of_speech,lexical_type)
              DO UPDATE SET lemma=lexical_units.lemma RETURNING id''',lexeme['term'].strip()[:120],normalized,pos,typ,
              lexeme['provenance'] or 'user_provided')
            await con.execute('UPDATE lexemes SET lexical_unit_id=$1 WHERE id=$2 AND lexical_unit_id IS NULL',unit,lexeme['id'])
            await con.execute('''INSERT INTO lexical_unit_forms(lexical_unit_id,form,form_norm,form_type)
               VALUES($1,$2,$3,'lemma') ON CONFLICT DO NOTHING''',unit,lexeme['term'][:160],normalized[:160])
        inserted=await con.fetchrow('''INSERT INTO user_vocabulary(user_id,lexeme_id,sense_key,folder_id,topic_pack,source_type,source_id,
           source_snapshot,srs_stage,mastery,next_review_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,0,'new',NOW()) RETURNING id''',user_id,lexeme['id'],key,
           folder_id,topic_pack,source_type,source_id,json.dumps(item['sourceSnapshot']) if item.get('sourceSnapshot') else None)
        ids.append(str(inserted['id']));count+=1;known_senses[key]=str(inserted['id'])
    if count:
        await con.execute('UPDATE users SET last_meaningful_activity_at=GREATEST(last_meaningful_activity_at,NOW()) WHERE id=$1',user_id)
    await con.execute('''INSERT INTO activity_events(user_id,type,payload) VALUES($1,'VOCABULARY_ADDED',$2::jsonb)''',
       user_id,json.dumps({'added':count,'duplicates':len(items)-len(collapsed),'sourceType':source_type,'topicPack':topic_pack}))
    return {'ok':True,'added':count,'duplicates':len(items)-count,'ids':ids,'points':0}
