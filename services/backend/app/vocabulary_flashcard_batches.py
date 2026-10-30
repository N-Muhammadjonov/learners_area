"""Source-named study groups retaining private assessments and every owned word."""
import json
from functools import lru_cache
from pathlib import Path
from . import main as core
from .db import row_to_dict

BATCH_SIZE=10

@lru_cache(maxsize=1)
def source_groups():
    from .step21_vocab_batch import sense_key
    root=Path(__file__).parent
    packs=json.loads((root/'vocabulary_builtin_packs.json').read_text())
    groups=json.loads((root/'vocabulary_pack_groups.json').read_text())
    result={}
    for pack in packs:
        for index,g in enumerate(groups.get(pack['id'],[])):
            for position in range(g['start'],g['end']):
                word=pack['words'][position]
                result[(pack['id'],sense_key(word))]=(index,g['label'],position)
    return result

def batch_plan(ids,marks,parts=None):
    parts=parts if parts is not None else [(None,ids[i:i+BATCH_SIZE]) for i in range(0,len(ids),BATCH_SIZE)]
    groups=[];unlocked=True;start=0
    for label,part in parts:
        known=sum(marks.get(str(i))=='known' for i in part)
        complete=known==len(part)
        groups.append({'index':len(groups),'start':start,'count':len(part),'known':known,
                       'complete':complete,'unlocked':unlocked,**({'label':label} if label else {})})
        start+=len(part);unlocked=unlocked and complete
    return groups

def named_parts(rows):
    from .step21_vocab_batch import sense_key
    lookup=source_groups();named={};other=[]
    for r in rows:
        pack=r.get('topic_pack')
        group=lookup.get((pack,r.get('sense_key')))
        if not group and pack:
            group=lookup.get((pack,sense_key({'term':r['term'],'partOfSpeech':r.get('part_of_speech'),
                                            'definitionEn':r['definition_en']})))
        if group:
            index,label,position=group
            named.setdefault((pack,index,label),[]).append((position,r['id']))
        else:other.append(r['id'])
    parts=[(key[2],[id for _,id in sorted(members,key=lambda p:p[0])]) for key,members in sorted(named.items())]
    parts.extend((None,other[i:i+BATCH_SIZE]) for i in range(0,len(other),BATCH_SIZE))
    return parts

def group_ids(ids,groups,index):
    g=groups[index]
    return ids[g['start']:g['start']+g['count']]

async def load_groups(con,user_id,key,folder,topic):
    from .step19_vocab_games_port import conditions
    args=[user_id];where=conditions(key,folder,topic,args)
    rows=await con.fetch(f'''SELECT uv.id,(uv.next_review_at<=NOW()) AS due,
        uv.topic_pack,l.sense_key,l.term,l.part_of_speech,l.definition_en
        FROM user_vocabulary uv JOIN lexemes l ON l.id=uv.lexeme_id
        WHERE {where} ORDER BY uv.created_at,uv.id''',*args)
    parts=named_parts(rows);ids=[id for _,part in parts for id in part]
    records=await con.fetch('''SELECT DISTINCT ON (payload->>'entryId')
        payload->>'entryId' AS eid,(payload->>'correct')::boolean AS known
        FROM activity_events WHERE user_id=$1 AND type='VOCAB_GAME_PRACTICED'
        AND payload->>'kind'='self' AND payload->>'entryId'=ANY($2::text[])
        ORDER BY payload->>'entryId',created_at DESC,id DESC''',user_id,[str(i) for i in ids]) if ids else []
    marks={r['eid']:'known' if r['known'] else 'notYet' for r in records}
    return ids,marks,batch_plan(ids,marks,parts),sum(bool(r['due']) for r in rows)

async def read_batch(con,user_id,key,folder,topic,requested):
    ids,marks,groups,due=await load_groups(con,user_id,key,folder,topic)
    index=requested if requested is not None else next((g['index'] for g in groups if not g['complete']),max(0,len(groups)-1))
    if groups and index>=len(groups) or not groups and index!=0:
        return core.j({'error':'batch_not_found'},404,{'Cache-Control':'private, no-store'})
    if groups and not groups[index]['unlocked']:
        return core.j({'error':'batch_locked'},403,{'Cache-Control':'private, no-store'})
    selected=group_ids(ids,groups,index) if groups else []
    rows=await con.fetch('''SELECT uv.id,l.term,l.definition_en AS "definitionEn",
        l.part_of_speech AS "partOfSpeech",l.translation_uz AS "translationUz",
        l.collocations,l.example_sentence AS "exampleSentence"
        FROM user_vocabulary uv JOIN lexemes l ON l.id=uv.lexeme_id
        WHERE uv.user_id=$1 AND uv.id=ANY($2::uuid[])''',user_id,selected) if selected else []
    by_id={str(r['id']):row_to_dict(r) for r in rows}
    return core.j({'ok':True,'key':key,'count':len(rows),'total':len(ids),'due':due,
        'words':[by_id[str(id)] for id in selected],'batchIndex':index,'batchSize':len(selected),
        'batches':groups,'selfAssessments':{str(i):marks[str(i)] for i in selected if str(i) in marks}},
        headers={'Cache-Control':'private, no-store'})
