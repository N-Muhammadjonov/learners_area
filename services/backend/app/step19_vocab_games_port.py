"""Vocabulary casual games (no SRS state changes).
The server verifies spelling/pair/sentence and deduplicates points per Tashkent day.
"""
from __future__ import annotations
import json,math,random,re
from datetime import datetime,timezone,timedelta
from pathlib import Path
from fastapi import APIRouter,Request
from . import main as core
from .db import row_to_dict
from .vocabulary_game_content import eligible_words
router=APIRouter()
SETS=('all','due','weak','reading','listening','topic','folder','assigned')
GAMES=('cards','choice','match','gap','race','translation','builder')
MODES={'cards':'self','choice':'spelling','match':'pair','gap':'spelling','race':'spelling',
       'translation':'spelling','builder':'sentence'}
PRIVATE={'Cache-Control':'private, no-store'}

def normalize(s):
    return ' '.join(re.sub(r"[^a-z0-9' ]+",' ',s.lower().replace('\u2018',"'").replace('\u2019',"'").replace('\u02bb',"'").replace('`',"'")).split())

def builtin_ids():
    return {x['id'] for x in json.loads(Path(__file__).with_name('vocabulary_builtin_packs.json').read_text())}

def conditions(key,folder,topic,args):
    where=['uv.user_id=$1']
    if key=='folder':
        if not folder:return 'FALSE'
        args.append(folder);where.append(f'uv.folder_id=${len(args)}')
    if key=='topic':
        if topic:
            args.append(topic);where.append(f'uv.topic_pack=${len(args)}')
        else:where.append('uv.topic_pack IS NOT NULL')
    if key in ('reading','listening','assigned'):
        args.append('assignment' if key=='assigned' else key);where.append(f'uv.source_type=${len(args)}')
    if key=='due':where.append('uv.next_review_at<=NOW()')
    if key=='weak':where.append('''uv.mastery NOT IN ('mastered','active') AND
        (uv.correct_count+uv.incorrect_count=0 OR
        uv.correct_count::numeric/NULLIF(uv.correct_count+uv.incorrect_count,0)<0.6)''')
    return ' AND '.join(where)

def size(raw):
    try:
        if raw is None:return 24
        f=float(raw) if str(raw).strip() else 0
        return max(1,min(500,math.floor(f))) if math.isfinite(f) else 24
    except (ValueError,OverflowError):return 24

@router.get('/api/vocabulary/games')
async def get_games(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    key=req.query_params.get('set','due')
    if key not in SETS:key='due'
    folder=req.query_params.get('folderId');topic=req.query_params.get('topicPack')
    game=req.query_params.get('game')
    if game and game not in GAMES:return core.j({'error':'invalid_game'},400)
    limit=size(req.query_params.get('limit'))
    raw_ids=req.query_params.get('entryIds')
    saved_ids=None
    if raw_ids is not None:
        candidates=raw_ids.split(',')
        if not game or game=='cards' or not 1<=len(candidates)<=24 or len(set(candidates))!=len(candidates) or any(not core.uuid_value(v) for v in candidates):
            return core.j({'error':'invalid_entry_ids'},400,PRIVATE)
        saved_ids=[core.uuid_value(v) for v in candidates]
    args=[user['id']];where=conditions(key,folder,topic,args)
    if saved_ids is not None:
        args.append(saved_ids)
        where+=f' AND uv.id=ANY({len(args)}::uuid[])'
    db=await core.pool()
    async with db.acquire() as con:
        if game=='cards' and req.query_params.get('batches')=='1':
            raw=req.query_params.get('batch')
            if raw is not None and (not raw.isdecimal() or len(raw)>7):return core.j({'error':'invalid_batch'},400,PRIVATE)
            if folder and not core.uuid_value(folder):return core.j({'error':'invalid_input'},400,PRIVATE)
            from .vocabulary_flashcard_batches import read_batch
            return await read_batch(con,user['id'],key,folder,topic,int(raw) if raw is not None else None)
        rows=await con.fetch(f'''SELECT uv.id,l.term,l.accepted_translations AS "acceptedTranslations",
            l.part_of_speech AS "partOfSpeech",l.definition_en AS "definitionEn",
            l.translation_uz AS "translationUz",l.example_sentence AS "exampleSentence",
            l.collocations,uv.mastery,uv.srs_stage AS "srsStage",uv.interval_days AS "intervalDays",
            uv.next_review_at AS "nextReviewAt",uv.correct_count AS "correctCount",
            uv.incorrect_count AS "incorrectCount",uv.active_use_count AS "activeUseCount",
            uv.folder_id AS "folderId",uv.topic_pack AS "topicPack",uv.source_type AS "sourceType",
            uv.source_snapshot AS "sourceSnapshot",uv.created_at AS "createdAt"
            FROM user_vocabulary uv JOIN lexemes l ON l.id=uv.lexeme_id WHERE {where}
            ORDER BY random() LIMIT 500''',*args)
        totals=await con.fetchrow(f'''SELECT count(*)::int AS total,
          count(*) FILTER(WHERE next_review_at<=NOW())::int AS due
          FROM user_vocabulary uv WHERE {where}''',*args)
        words=[row_to_dict(r) for r in rows]
        eligible=eligible_words(words,game)
        if saved_ids is not None:
            by_id={str(w['id']):w for w in eligible}
            eligible=[by_id[str(entry_id)] for entry_id in saved_ids if str(entry_id) in by_id]
        if saved_ids is None and game and req.query_params.get('random')=='1':
            random.shuffle(eligible)
        chosen=eligible[:limit] if game else []
        projected=[]
        for w in chosen:
            obj={'id':w['id'],'term':w['term'],'definitionEn':w['definitionEn']}
            for field in {'cards':('partOfSpeech','translationUz','collocations','exampleSentence'),
                 'choice':('acceptedTranslations',),
                 'race':('translationUz','sourceType'),'gap':('exampleSentence',),
                 'builder':('exampleSentence',),'translation':('translationUz','acceptedTranslations','collocations','exampleSentence')}.get(game,()):
                obj[field]=w.get(field)
            projected.append(obj)
        payload={'ok':True,'key':key,'count':len(chosen),'due':int(totals['due'] or 0),
                 'total':int(totals['total'] or 0),'words':projected}
        if game=='cards':
            ids=[x['id'] for x in projected]
            records=await con.fetch('''SELECT payload->>'entryId' AS eid,(payload->>'correct')::boolean AS known
               FROM activity_events WHERE user_id=$1 AND type='VOCAB_GAME_PRACTICED'
               AND payload->>'kind'='self' AND payload->>'entryId'=ANY($2::text[])
               ORDER BY created_at DESC''',user['id'],ids)
            flags={}
            for r in records:
                if r['eid'] not in flags:flags[r['eid']]='known' if r['known'] else 'notYet'
            payload['selfAssessments']=flags
        return core.j(payload)

def input_valid(b):
    if not isinstance(b,dict) or set(b)-{'entryId','set','gameId','folderId','topicPack','submission','batchIndex'}:return False
    if not core.uuid_value(b.get('entryId')) or b.get('set') not in SETS or b.get('gameId') not in GAMES:return False
    if b.get('folderId') is not None and not core.uuid_value(b['folderId']):return False
    if b.get('topicPack') is not None and (not isinstance(b['topicPack'],str) or len(b['topicPack'])>100):return False
    if 'batchIndex' in b and (b.get('gameId')!='cards' or type(b['batchIndex'])!=int or not 0<=b['batchIndex']<=1000000):return False
    sub=b.get('submission')
    if not isinstance(sub,dict) or sub.get('kind') not in ('spelling','sentence','pair','self'):return False
    kind=sub['kind']
    if kind in ('spelling','sentence'):return set(sub)=={'kind','text'} and isinstance(sub['text'],str) and len(sub['text'])<=(300 if kind=='spelling' else 600)
    if kind=='pair':return set(sub)=={'kind','pairEntryId'} and bool(core.uuid_value(sub.get('pairEntryId')))
    return set(sub)=={'kind','known'} and type(sub['known'])==bool

async def in_set(con,entry,key,folder,topic,user_id,now):
    if key=='all':return True
    if key=='due':return entry['next_review_at']<=now
    if key=='weak':
        count=entry['correct_count']+entry['incorrect_count']
        return entry['mastery'] not in ('mastered','active') and (count==0 or entry['correct_count']/count<0.6)
    if key in ('reading','listening','assigned'):return entry['source_type']==('assignment' if key=='assigned' else key)
    if key=='folder' and folder:
        folder_found=await con.fetchval('SELECT id FROM vocab_folders WHERE id=$1 AND user_id=$2',folder,user_id)
        return bool(folder_found and entry['folder_id']==folder_found)
    if key=='topic':return entry['topic_pack']==topic and topic in builtin_ids() if topic else entry['topic_pack'] in builtin_ids()
    return False

@router.post('/api/vocabulary/games')
async def answer_game(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    b=await core.payload(req)
    if not input_valid(b):return core.j({'error':'invalid_input'},400)
    db=await core.pool();now=datetime.now(timezone.utc)
    async with db.acquire() as con:
        entry=await con.fetchrow('SELECT * FROM user_vocabulary WHERE id=$1 AND user_id=$2',b['entryId'],user['id'])
        if not entry:return core.j({'error':'not_found'},404)
        if not await in_set(con,entry,b['set'],b.get('folderId'),b.get('topicPack'),user['id'],now):return core.j({'error':'not_in_set'},404)
        if 'batchIndex' in b:
            from .vocabulary_flashcard_batches import load_groups,group_ids
            ids,marks,groups,due=await load_groups(con,user['id'],b['set'],b.get('folderId'),b.get('topicPack'))
            batch=b['batchIndex']
            if batch>=len(groups) or str(entry['id']) not in {str(i) for i in group_ids(ids,groups,batch)}:
                return core.j({'error':'batch_changed'},409,PRIVATE)
            if not groups[batch]['unlocked']:return core.j({'error':'batch_locked'},403,PRIVATE)
        lexeme=await con.fetchrow('SELECT * FROM lexemes WHERE id=$1',entry['lexeme_id'])
        if not lexeme:return core.j({'error':'not_found'},404)
        authored={'id':entry['id'],'term':lexeme['term'],'definitionEn':lexeme['definition_en'],
                  'translationUz':lexeme['translation_uz'],'exampleSentence':lexeme['example_sentence']}
        if not eligible_words([authored],b['gameId']):
            return core.j({'error':'ineligible_word'},409,PRIVATE)
        sub=b['submission'];kind=sub['kind']
        verified=kind!='self' and MODES[b['gameId']]==kind
        correct=False
        if verified and kind=='spelling':
            answer=normalize(sub['text']);allowed={normalize(a) for a in [lexeme['term'],*(lexeme['accepted_translations'] or [])]}
            correct=bool(answer) and answer in allowed
        elif verified and kind=='sentence':
            actual=normalize(sub['text']);correct=bool(actual) and actual==normalize(lexeme['example_sentence'] or lexeme['definition_en'])
        elif verified and kind=='pair':
            pair=await con.fetchrow('SELECT * FROM user_vocabulary WHERE id=$1 AND user_id=$2',sub['pairEntryId'],user['id'])
            if not pair or not await in_set(con,pair,b['set'],b.get('folderId'),b.get('topicPack'),user['id'],now):
                return core.j({'error':'not_in_set'},404)
            correct=str(entry['id'])==sub['pairEntryId']
        elif kind=='self' and b['gameId']=='cards':correct=sub['known']
        awarded=False
        async with con.transaction():
            await con.execute('''INSERT INTO activity_events(user_id,type,payload)
                 VALUES($1,'VOCAB_GAME_PRACTICED',jsonb_build_object('entryId',$2::text,'kind',$3::text,
                 'correct',$4::boolean,'verified',$5::boolean))''',user['id'],b['entryId'],kind,correct,verified)
            if correct and verified:
                day=(now+timedelta(hours=5)).strftime('%Y-%m-%d')
                award=await con.fetchval('''INSERT INTO vocab_point_events(user_id,kind,points,dedupe_key,ref_type,ref_id)
                  VALUES($1,'game_answer',1,$2,'user_vocabulary',$3) ON CONFLICT(dedupe_key) DO NOTHING RETURNING id''',
                  user['id'],f"game:{user['id']}:{b['entryId']}:{day}",b['entryId'])
                awarded=bool(award)
        try:await con.execute('''UPDATE users SET last_meaningful_activity_at=GREATEST(last_meaningful_activity_at,NOW()) WHERE id=$1''',user['id'])
        except Exception:pass
        return core.j({'ok':True,'correct':bool(correct),'verified':verified,'awarded':1 if awarded else 0,'srsUntouched':True})


def attempt_scope(data):
    if not isinstance(data,dict):return None
    game=data.get('gameId');key=data.get('set')
    if game not in GAMES or key not in SETS:return None
    folder=data.get('folderId') if key=='folder' else None
    topic=data.get('topicPack') if key=='topic' else None
    if key=='folder' and not core.uuid_value(folder):return None
    if key=='topic' and (not isinstance(topic,str) or not 1<=len(topic)<=100):return None
    batch=data.get('batchIndex') if game=='cards' else None
    if game=='cards' and (type(batch)!=int or not 0<=batch<=1000000):return None
    return {'gameId':game,'set':key,'folderId':folder,'topicPack':topic,'batchIndex':batch,
            'scope':json.dumps([game,key,folder,topic,batch],separators=(',',':'))}


async def latest_attempt(con,user_id,scope):
    return await con.fetchrow('''SELECT id,payload FROM activity_events
        WHERE user_id=$1 AND type='VOCAB_GAME_ATTEMPT' AND payload->>'scope'=$2
        ORDER BY created_at DESC,id DESC LIMIT 1''',user_id,scope)


@router.get('/api/vocabulary/games/attempt')
async def get_game_attempt(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    params=dict(req.query_params)
    if 'batchIndex' in params:
        if not params['batchIndex'].isdecimal() or len(params['batchIndex'])>7:
            return core.j({'error':'invalid_input'},400,PRIVATE)
        params['batchIndex']=int(params['batchIndex'])
    scope=attempt_scope(params)
    if scope is None:return core.j({'error':'invalid_input'},400,PRIVATE)
    db=await core.pool()
    async with db.acquire() as con:
        if scope['folderId'] and not await con.fetchval(
            'SELECT 1 FROM vocab_folders WHERE id=$1 AND user_id=$2',
            scope['folderId'],user['id']):
            return core.j({'error':'folder_not_found'},404,PRIVATE)
        row=await latest_attempt(con,user['id'],scope['scope'])
    return core.j({'ok':True,'attempt':{**row['payload'],'attemptId':str(row['id'])} if row else None},headers=PRIVATE)


@router.post('/api/vocabulary/games/attempt')
async def update_game_attempt(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    body=await core.payload(req)
    if not isinstance(body,dict) or body.get('action') not in ('start','save'):
        return core.j({'error':'invalid_input'},400,PRIVATE)
    scope=attempt_scope(body)
    if scope is None:return core.j({'error':'invalid_input'},400,PRIVATE)
    state=body.get('state',{})
    if (not isinstance(state,dict) or len(state)>32
        or len(json.dumps(state,ensure_ascii=False))>12000):
        return core.j({'error':'invalid_state'},400,PRIVATE)
    db=await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            await con.fetchrow('SELECT id FROM users WHERE id=$1 FOR UPDATE',user['id'])
            if scope['folderId'] and not await con.fetchval(
                'SELECT 1 FROM vocab_folders WHERE id=$1 AND user_id=$2',
                scope['folderId'],user['id']):
                return core.j({'error':'folder_not_found'},404,PRIVATE)
            latest=await latest_attempt(con,user['id'],scope['scope'])
            if body['action']=='start':
                deck=body.get('deck')
                max_words=10 if scope['gameId']=='cards' else 24
                if (not isinstance(deck,list) or not 1<=len(deck)<=max_words
                    or len(set(map(str,deck)))!=len(deck)
                    or any(not isinstance(v,str) or not core.uuid_value(v) for v in deck)):
                    return core.j({'error':'invalid_deck'},400,PRIVATE)
                rows=await con.fetch('SELECT * FROM user_vocabulary WHERE user_id=$1 AND id=ANY($2::uuid[])',
                                     user['id'],[core.uuid_value(v) for v in deck])
                if len(rows)!=len(deck):
                    return core.j({'error':'invalid_deck'},400,PRIVATE)
                now=datetime.now(timezone.utc)
                for entry in rows:
                    if not await in_set(con,entry,scope['set'],scope['folderId'],scope['topicPack'],user['id'],now):
                        return core.j({'error':'invalid_deck'},400,PRIVATE)
                if scope['gameId']=='cards':
                    from .vocabulary_flashcard_batches import load_groups,group_ids
                    ids,marks,groups,due=await load_groups(con,user['id'],scope['set'],scope['folderId'],scope['topicPack'])
                    batch=scope['batchIndex']
                    if batch>=len(groups) or not groups[batch]['unlocked']:
                        return core.j({'error':'batch_locked'},409,PRIVATE)
                    if not set(deck).issubset({str(x) for x in group_ids(ids,groups,batch)}):
                        return core.j({'error':'invalid_deck'},400,PRIVATE)
                data={**scope,'deck':deck,'state':state,'revision':0}
                row=await con.fetchrow('''INSERT INTO activity_events(user_id,type,payload)
                      VALUES($1,'VOCAB_GAME_ATTEMPT',$2::jsonb) RETURNING id''',
                      user['id'],json.dumps(data,ensure_ascii=False))
                return core.j({'ok':True,'attempt':{**data,'attemptId':str(row['id'])}},headers=PRIVATE)
            attempt_id=body.get('attemptId')
            revision=body.get('revision')
            if not core.uuid_value(attempt_id) or type(revision)!=int or revision<0:
                return core.j({'error':'invalid_input'},400,PRIVATE)
            if not latest or str(latest['id'])!=attempt_id or latest['payload'].get('revision')!=revision:
                return core.j({'error':'stale_attempt'},409,PRIVATE)
            data={**latest['payload'],'state':state,'revision':revision+1}
            row=await con.fetchrow('''UPDATE activity_events SET payload=$3::jsonb
                  WHERE id=$1 AND user_id=$2 AND type='VOCAB_GAME_ATTEMPT'
                  RETURNING id''',core.uuid_value(attempt_id),user['id'],json.dumps(data,ensure_ascii=False))
            if not row:return core.j({'error':'stale_attempt'},409,PRIVATE)
            return core.j({'ok':True,'attempt':{**data,'attemptId':attempt_id}},headers=PRIVATE)


def install():core.app.include_router(router)

