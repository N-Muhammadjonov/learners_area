"""Stable ten-word study groups backed by existing private assessment events."""
from . import main as core
from .db import row_to_dict

BATCH_SIZE=10

def batch_plan(ids,marks):
    groups=[]
    unlocked=True
    for start in range(0,len(ids),BATCH_SIZE):
        part=ids[start:start+BATCH_SIZE]
        known=sum(marks.get(str(i))=='known' for i in part)
        complete=known==len(part)
        groups.append({'index':start//BATCH_SIZE,'count':len(part),'known':known,
                       'complete':complete,'unlocked':unlocked})
        unlocked=unlocked and complete
    return groups

async def load_groups(con,user_id,key,folder,topic):
    from .step19_vocab_games_port import conditions
    args=[user_id]
    where=conditions(key,folder,topic,args)
    rows=await con.fetch(f'''SELECT uv.id,(uv.next_review_at<=NOW()) AS due
        FROM user_vocabulary uv JOIN lexemes l ON l.id=uv.lexeme_id
        WHERE {where} ORDER BY uv.created_at,uv.id''',*args)
    ids=[r['id'] for r in rows]
    records=await con.fetch('''SELECT DISTINCT ON (payload->>'entryId')
        payload->>'entryId' AS eid,(payload->>'correct')::boolean AS known
        FROM activity_events WHERE user_id=$1 AND type='VOCAB_GAME_PRACTICED'
        AND payload->>'kind'='self' AND payload->>'entryId'=ANY($2::text[])
        ORDER BY payload->>'entryId',created_at DESC,id DESC''',user_id,[str(i) for i in ids]) if ids else []
    marks={r['eid']:'known' if r['known'] else 'notYet' for r in records}
    return ids,marks,batch_plan(ids,marks),sum(bool(r['due']) for r in rows)

async def read_batch(con,user_id,key,folder,topic,requested):
    ids,marks,groups,due=await load_groups(con,user_id,key,folder,topic)
    index=requested if requested is not None else next((g['index'] for g in groups if not g['complete']),max(0,len(groups)-1))
    if groups and index>=len(groups) or not groups and index!=0:
        return core.j({'error':'batch_not_found'},404,{'Cache-Control':'private, no-store'})
    if groups and not groups[index]['unlocked']:
        return core.j({'error':'batch_locked'},403,{'Cache-Control':'private, no-store'})
    selected=ids[index*BATCH_SIZE:(index+1)*BATCH_SIZE]
    rows=await con.fetch('''SELECT uv.id,l.term,l.definition_en AS "definitionEn",
        l.part_of_speech AS "partOfSpeech",l.translation_uz AS "translationUz",
        l.collocations,l.example_sentence AS "exampleSentence"
        FROM user_vocabulary uv JOIN lexemes l ON l.id=uv.lexeme_id
        WHERE uv.user_id=$1 AND uv.id=ANY($2::uuid[]) ORDER BY uv.created_at,uv.id''',user_id,selected) if selected else []
    return core.j({'ok':True,'key':key,'count':len(rows),'total':len(ids),'due':due,
        'words':[row_to_dict(r) for r in rows],'batchIndex':index,'batchSize':BATCH_SIZE,
        'batches':groups,'selfAssessments':{str(i):marks[str(i)] for i in selected if str(i) in marks}},
        headers={'Cache-Control':'private, no-store'})
