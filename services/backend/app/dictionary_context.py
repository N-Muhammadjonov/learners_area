"""Explicit, hash-guarded editorial occurrence bindings from main.

This is a trusted maintenance operation, not an exposed learner API. It never
chooses a sense by spelling, updates a saved word, grades work or advances SRS.
"""
import hashlib,json,re
from uuid import UUID
import regex
from .dictionary_materialize import materialize
from .dictionary_presentation import meaning_hash
from .step17_dictionary_read_port import active_release,entry,normalize_search
from .step30_video_lexical import forms_of,normalize_lex,sentence_at
from .js_text import length,slice as js_slice


def digest(value):return hashlib.sha256(value.encode()).hexdigest()
def identifier(value):
    try:return isinstance(value,str) and bool(re.fullmatch(r'[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}',value,re.I))
    except (TypeError,ValueError):return False

def text(value,minimum,maximum):return isinstance(value,str) and minimum<=length(value)<=maximum

def span_shape(row,previous=False):
    required={'start','end','surface'} if previous else {'start','end','surface','entryId','senseId','meaningSha'}
    optional=set() if previous else {'formParts','before'}
    if not isinstance(row,dict) or not required<=set(row) or set(row)-required-optional:return False
    if type(row['start']) is not int or type(row['end']) is not int or row['start']<0 or row['end']<=row['start'] or not text(row['surface'],1,120):return False
    if previous:return True
    if not identifier(row['entryId']) or not identifier(row['senseId']) or not isinstance(row['meaningSha'],str) or not re.fullmatch('[a-f0-9]{64}',row['meaningSha']):return False
    if 'formParts' in row:
        parts=row['formParts']
        if not isinstance(parts,list) or not 2<=len(parts)<=8:return False
        if any(not isinstance(p,dict) or set(p)!={'start','end'} or type(p['start']) is not int or type(p['end']) is not int or p['start']<0 or p['end']<=0 for p in parts):return False
    if 'before' in row:
        before=row['before']
        if not isinstance(before,dict) or not {'id','lexemeId','status'}<=set(before) or set(before)-{'id','lexemeId','status','location'}:return False
        if not identifier(before['id']) or before['lexemeId'] is not None and not identifier(before['lexemeId']) or before['status'] not in ('resolved','unresolved','review'):return False
        if 'location' in before and not span_shape(before['location'],True):return False
    return True


def matches_context_form(value,surface,parts=None):
    form=surface
    if parts is not None:
        if ' ' not in value['display_lemma'] or not 2<=len(parts)<=8 or parts[0]['start']!=0 or parts[-1]['end']!=length(surface):return False
        for index,part in enumerate(parts):
            start,end=part['start'],part['end']
            if start<0 or end<=start or end>length(surface):return False
            allowed=r"[\p{L}\p{M}'\u2018\u2019\u02bc\u02bb -]+"
            if index:
                previous=parts[index-1]['end'];gap=js_slice(surface,previous,start)
                if previous>=start or length(gap)>80 or not regex.fullmatch(allowed,gap):return False
            if not regex.fullmatch(allowed,js_slice(surface,start,end)):return False
        form=' '.join(js_slice(surface,p['start'],p['end']) for p in parts)
    forms={normalize_search(term) for term in [value['display_lemma'],value['normalized_search_form'],*[f['surface_form'] for f in value['forms']]]}
    forms.update(row[1] for row in forms_of(value['display_lemma'],value['part_of_speech']))
    term=normalize_lex(form);variants={term}
    if term.endswith("'s") and length(term)>3:variants.add(term[:-2])
    variants.update(item.replace('-',' ') for item in list(variants) if '-' in item)
    return any(normalize_search(candidate) in forms for candidate in variants)


def study_segments(payload):
    sections=payload['sections'];questions=payload.get('questions',[]);first=sections[0]['number'] if sections else 1
    def section_for(number):return next((q['section'] for q in questions if q['number']==number),first)
    result=[{'key':'s'+str(s['number']),'section':s['number'],'text':s['transcript']} for s in sections]
    for q in questions:
        result.extend([{'key':f'q{q["number"]}:text','section':q['section'],'text':q['text']},{'key':f'q{q["number"]}:why','section':q['section'],'text':q['evidence']['why']}])
        result.extend({'key':f'q{q["number"]}:option:{i}','section':q['section'],'text':body} for i,body in enumerate(q['options']))
    for family,fields in [('keyword1',('text','heard','link')),('keyword2',('heard','link'))]:
        for row in payload.get(family,[]):
            result.extend({'key':f'k{1 if family=="keyword1" else 2}:{row["q"]}:{field}','section':row.get('part',section_for(row.get('sourceQuestion',row['q']))),'text':row[field]} for field in fields)
    result.extend({'key':f'v:{index}:example','section':first,'text':row['ex']} for index,row in enumerate(payload.get('vocabulary',[])))
    return result


async def apply_context_bindings(con,plan):
    if not isinstance(plan,dict) or set(plan)!={'version','releaseId','reviewer','materials'} or plan['version']!=1 or not text(plan['releaseId'],1,100) or not isinstance(plan['reviewer'],str) or not text(plan['reviewer'].strip(),1,120) or not isinstance(plan['materials'],list) or not 1<=len(plan['materials'])<=64:
        raise ValueError('context_binding_invalid')
    materials=plan['materials'];total=0;previous=[];identities=[]
    def identity(m):return ':'.join(str(v) if v is not None else '' for v in [m['source'],m['sourceId'],m.get('sectionNumber'),m.get('segmentKey')])
    for m in materials:
        if not isinstance(m,dict) or not {'source','sourceId','bodySha','spans'}<=set(m) or set(m)-{'source','sourceId','bodySha','spans','sectionNumber','segmentKey'} or m['source'] not in ('reading','retention','listening') or not identifier(m['sourceId']) or not isinstance(m['bodySha'],str) or not re.fullmatch('[a-f0-9]{64}',m['bodySha']) or not isinstance(m['spans'],list) or not 1<=len(m['spans'])<=2000 or not all(span_shape(s) for s in m['spans']):raise ValueError('context_binding_invalid')
        if 'sectionNumber' in m and (type(m['sectionNumber']) is not int or not 1<=m['sectionNumber']<=4) or 'segmentKey' in m and not text(m['segmentKey'],1,40):raise ValueError('context_binding_invalid')
        identities.append(identity(m));total+=len(m['spans']);previous.extend(s['before']['id'] for s in m['spans'] if s.get('before'))
    if total>5000 or len(set(identities))!=len(identities) or len(set(previous))!=len(previous):raise ValueError('context_binding_inventory_invalid')
    for m in materials:
        if m['source']=='listening':
            invalid=not m.get('sectionNumber') or not m.get('segmentKey')
        else:invalid='sectionNumber' in m or 'segmentKey' in m
        if invalid:raise ValueError('context_binding_segment_invalid')
    async with con.transaction():
        await con.execute('SELECT pg_advisory_xact_lock(387384)')
        if (await active_release(con))['active_release_id']!=plan['releaseId']:raise ValueError('release_mismatch')
        entries={}
        for key in dict.fromkeys(s['entryId'] for m in materials for s in m['spans']):
            value=await entry(con,UUID(key),plan['releaseId'])
            if value:entries[key]=value
        bodies={};old_rows={}
        for m in sorted(materials,key=identity):
            source=m['source'];column={'reading':'passage_id','retention':'retention_text_version_id','listening':'listening_test_id'}[source]
            if source=='listening':
                row=await con.fetchrow('SELECT payload FROM listening_packages WHERE test_id=$1 FOR UPDATE',UUID(m['sourceId']))
                payload=row['payload'] if row else None;payload=json.loads(payload) if isinstance(payload,str) else payload
                matches=[s for s in study_segments(payload) if s['section']==m['sectionNumber'] and s['key']==m['segmentKey']] if payload else []
                body=matches[0]['text'] if len(matches)==1 else None
            else:
                table='reading_passages' if source=='reading' else 'retention_text_versions'
                body=await con.fetchval('SELECT body_text FROM '+table+' WHERE id=$1 FOR UPDATE',UUID(m['sourceId']))
            if body is None or digest(body)!=m['bodySha']:raise ValueError('context_source_changed')
            bodies[identity(m)]=body
            extra=' AND section_number=$3 AND segment_key=$4' if source=='listening' else ''
            arguments=[source,UUID(m['sourceId']),*([m['sectionNumber'],m['segmentKey']] if extra else [])]
            existing=[dict(r) for r in await con.fetch('SELECT id,lexeme_id,resolution_status,start_char,end_char,surface_form,section_number,segment_key FROM lexical_occurrences WHERE source_type=$1 AND '+column+'=$2'+extra+' FOR UPDATE',*arguments)]
            old_rows[identity(m)]=existing
            ordered=sorted(m['spans'],key=lambda s:(s['start'],s['end']))
            for index,s in enumerate(ordered):
                value=entries.get(s['entryId']);sense=next((v for v in value['senses'] if v['sense_id']==s['senseId']),None) if value else None
                if s['end']>length(body) or js_slice(body,s['start'],s['end'])!=s['surface']:raise ValueError('context_surface_changed')
                if regex.search(r'[\p{L}\p{M}]',js_slice(body,s['start']-1,s['start'])) or regex.search(r'[\p{L}\p{M}]',js_slice(body,s['end'],s['end']+1)):raise ValueError('context_partial_word')
                if index and ordered[index-1]['end']>s['start']:raise ValueError('context_binding_overlap')
                if not value or not sense or meaning_hash(value,sense)!=s['meaningSha']:raise ValueError('context_meaning_changed')
                if not matches_context_form(value,s['surface'],s.get('formParts')):raise ValueError('context_surface_not_dictionary_form')
                previous=s.get('before',{}).get('location')
                if previous and (previous['end']>length(body) or js_slice(body,previous['start'],previous['end'])!=previous['surface']):raise ValueError('context_previous_surface_changed')
                if any(o['start_char']<s['end'] and o['end_char']>s['start'] and (str(o['id'])!=s['before']['id'] if previous else o['start_char']!=s['start'] or o['end_char']!=s['end']) for o in existing):raise ValueError('context_existing_overlap_requires_review')
        inserted=updated=unchanged=0;canonical={}
        for m in materials:
            for s in m['spans']:
                if s['senseId'] not in canonical:canonical[s['senseId']]=await materialize(con,entries[s['entryId']],s['senseId'])
                app_sense=canonical[s['senseId']]
                lexeme=await con.fetchrow('SELECT definition_en,lexical_unit_id FROM lexemes WHERE id=$1',app_sense)
                sense=next(v for v in entries[s['entryId']]['senses'] if v['sense_id']==s['senseId'])
                if not lexeme or normalize_search(lexeme['definition_en'])!=normalize_search(sense['definition_en']):raise ValueError('context_mapped_meaning_changed')
                if s.get('before',{}).get('location'):
                    existing=next((o for o in old_rows[identity(m)] if str(o['id'])==s['before']['id']),None)
                else:
                    existing=next((o for o in old_rows[identity(m)] if o['start_char']==s['start'] and o['end_char']==s['end']),None)
                if existing and str(existing['lexeme_id'])==str(app_sense) and existing['resolution_status']=='resolved' and existing['surface_form']==s['surface'] and existing['start_char']==s['start'] and existing['end_char']==s['end']:unchanged+=1;continue
                body=bodies[identity(m)];sentence=sentence_at(body,len(js_slice(body,0,s['start'])),len(js_slice(body,0,s['end'])))
                if existing:
                    before=s.get('before');location=before.get('location',s) if before else s
                    if not before or str(existing['id'])!=before['id'] or (str(existing['lexeme_id']) if existing['lexeme_id'] else None)!=before['lexemeId'] or existing['resolution_status']!=before['status'] or existing['surface_form']!=location['surface'] or existing['start_char']!=location['start'] or existing['end_char']!=location['end']:raise ValueError('context_previous_link_changed')
                    await con.execute("UPDATE lexical_occurrences SET start_char=$2,end_char=$3,surface_form=$4,lexeme_id=$5,lexical_unit_id=$6,resolution_status='resolved',resolution_source='context_editorial',sentence_text=$7,is_target_vocabulary=true WHERE id=$1",existing['id'],s['start'],s['end'],s['surface'],app_sense,lexeme['lexical_unit_id'],sentence);updated+=1
                else:
                    if s.get('before'):raise ValueError('context_previous_link_missing')
                    await con.execute("""INSERT INTO lexical_occurrences(source_type,passage_id,retention_text_version_id,listening_test_id,section_number,segment_key,start_char,end_char,surface_form,lexeme_id,lexical_unit_id,resolution_status,resolution_source,sentence_text,occurrence_type,is_target_vocabulary)
                        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'resolved','context_editorial',$12,'vocabulary',true)""",m['source'],UUID(m['sourceId']) if m['source']=='reading' else None,UUID(m['sourceId']) if m['source']=='retention' else None,UUID(m['sourceId']) if m['source']=='listening' else None,m.get('sectionNumber'),m.get('segmentKey'),s['start'],s['end'],s['surface'],app_sense,lexeme['lexical_unit_id'],sentence);inserted+=1
        return {'materials':len(materials),'reviewedSpans':total,'inserted':inserted,'updated':updated,'unchanged':unchanged,'learnerDataChanged':False,'semanticReviewAutomated':False}
