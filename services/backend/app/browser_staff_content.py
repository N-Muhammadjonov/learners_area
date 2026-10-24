"""Authoring metadata for native staff screens; existing writes retain authority."""
import json
from pathlib import Path
from fastapi import HTTPException
from . import main as core
from .browser_common import camel, identifier, live, number
from .browser_speaking import materials
from .writing_admin_content_port import TABLE, COLUMNS


async def writing(con, kind, q):
    selected = q.get('kind')
    if kind=='writing-admin':
        selected = q.get('section','lesson')
        selected = 'prompt' if selected=='exam' else selected if selected in (*TABLE,'topic') else 'lesson'
        counts = {}
        for key,table in TABLE.items():
            states = {r['publication_state']:r['n'] for r in await con.fetch(f'SELECT publication_state,count(*)::int n FROM {table} GROUP BY publication_state')}
            counts[key] = {'total':sum(states.values()),**{s:states.get(s,0) for s in ('draft','scheduled','published','archived')}}
        rows = []
        if selected!='topic':
            table = TABLE[selected]
            title = 'left(prompt,180)' if selected=='prompt' else 'pattern' if selected=='pattern' else 'title'
            subtitle = 'category' if selected in ('lesson','prompt') else 'topic'
            rows = [camel(r) for r in await con.fetch(f'SELECT id,{title} title,COALESCE({subtitle},\'\') subtitle,publication_state,publish_at FROM {table} ORDER BY created_at DESC LIMIT 5000')]
        return {'section':selected,'counts':counts,'rows':rows,'unavailable':False}
    if selected not in TABLE: raise HTTPException(404,'not_found')
    sources = [camel(r) for r in await con.fetch('SELECT id,title FROM writing_model_texts ORDER BY title LIMIT 1000')] if selected=='pattern' else []
    if kind=='writing-admin-new': return {'sources':sources}
    id = identifier(q.get('id'))
    row = await con.fetchrow(f'SELECT * FROM {TABLE[selected]} WHERE id=$1',id)
    if not row: raise HTTPException(404,'not_found')
    item = camel(row)
    if selected=='translation':
        item['sentences'] = [camel(r) for r in await con.fetch('SELECT position,uzbek_source,model_english,accepted_alternatives,notes,target_lexical_items FROM writing_translation_sentences WHERE set_id=$1 ORDER BY position',id)]
    return {'item':item,'sources':sources}


def staged(level):
    if level not in ('A2','B1','B2','C1','C2'): raise HTTPException(400,'invalid_level')
    from .step35_retention_scoring import evaluate_recall
    from .step20_retention_transitions_port import word_count
    root = Path(__file__).resolve().parents[1]/'assets/retention-v2'
    evidence = json.loads((root/'calibration-gaps.json').read_text())
    if evidence.get('status')!='QA_HOLD_DO_NOT_PUBLISH': raise HTTPException(409,'retention_staged_requires_review')
    held = {r['sourceId'] for r in evidence['anomalies']}
    items = []
    for line in (root/(level+'.jsonl')).read_text().splitlines():
        row = json.loads(line)
        if row['level']!=level: raise HTTPException(503,'retention_staged_level_mismatch')
        source_score, source = evaluate_recall(row['bodyText'],row['scoringStructure'])
        canonical_score, canonical = evaluate_recall('\n'.join(c['label'] for c in row['scoringStructure']['claims']),row['scoringStructure'])
        items.append({'sourceId':row['sourceId'],'level':level,'bodyText':row['bodyText'],'wordCount':word_count(row['bodyText']),'held':row['sourceId'] in held,'sourceScore':source_score,'canonicalScore':canonical_score,'missingGroups':[{'claimId':c['claimId'],'missingGroupIds':c['missingGroupIds']} for c in source['claims'] if c['missingGroupIds']]})
    return {'level':level,'report':{'items':items,'holdStatus':evidence['status'],'heldTextCount':sum(r['held'] for r in items),'mismatchCount':sum(r['sourceId'].startswith(level+'-') for r in evidence['anomalies'])}}


async def read(req, user, kind, q):
    if kind=='retention-staged': return staged(q.get('level','A2'))
    db = await core.pool()
    async with db.acquire() as con:
        if kind.startswith('writing-admin'): return await writing(con,kind,q)
        if kind=='grammar-topics': return {'topics':[camel(r) for r in await con.fetch('SELECT id,title,skill_area FROM grammar_topics ORDER BY "order",id LIMIT 1000')]}
        if kind=='grammar-topic':
            id = identifier(q.get('id'));row = await con.fetchrow('SELECT id,title,explanation FROM grammar_topics WHERE id=$1',id)
            if not row: raise HTTPException(404,'not_found')
            # Essay-derived exercises remain private to their learner even for staff catalogues.
            rows = await con.fetch('SELECT id,"order",prompt_text,correct_option FROM grammar_exercises WHERE topic_id=$1 AND source_owner_user_id IS NULL AND source_submission_id IS NULL ORDER BY "order",id LIMIT 1000',id)
            return {'topic':camel(row),'exercises':[camel(r) for r in rows]}
        if kind=='reading-passages': return {'passages':[camel(r) for r in await con.fetch('SELECT id,title,difficulty_level,suggested_minutes,publication_state,publish_at FROM reading_passages ORDER BY created_at DESC LIMIT 5000')]}
        if kind=='reading-passage':
            id = identifier(q.get('id'));row = await con.fetchrow('SELECT id,title,body_text FROM reading_passages WHERE id=$1',id)
            if not row: raise HTTPException(404,'not_found')
            return {'passage':camel(row),'questions':[camel(r) for r in await con.fetch('SELECT id,"order",question_text,type,correct_answer FROM reading_questions WHERE passage_id=$1 ORDER BY "order",id LIMIT 5000',id)]}
        if kind=='listening-import':
            ready = bool(await con.fetchval("SELECT to_regclass('public.listening_packages') IS NOT NULL AND to_regclass('public.content_versions') IS NOT NULL"))
            return {'schemaReady':ready}
        if kind=='listening-test':
            id = identifier(q.get('id'))
            row = await con.fetchrow('SELECT id,title,audio_url,audio_type FROM listening_tests WHERE id=$1',id)
            if not row: raise HTTPException(404,'not_found')
            if await con.fetchval('SELECT 1 FROM listening_packages WHERE test_id=$1',id): return {'redirectToFull':True}
            return {'test':camel(row),'questions':[camel(r) for r in await con.fetch('SELECT id,"order",question_text,type,correct_answer FROM listening_questions WHERE test_id=$1 ORDER BY "order"',id)]}
        if kind=='listening-library':
            page = number(q.get('page'))
            rows = await con.fetch('SELECT t.id,t.title,t.publication_state,p.payload,p.source_id FROM listening_tests t LEFT JOIN listening_packages p ON p.test_id=t.id ORDER BY t.created_at,t.id LIMIT 25 OFFSET $1',(page-1)*24)
            cards = []
            for row in rows[:24]:
                p = row['payload'] or {}
                if isinstance(p,str): p=json.loads(p)
                cards.append({'id':str(row['id']),'title':row['title'],'publicationState':row['publication_state'],'duration':int(p.get('audio',{}).get('durationSec') or 0),'sectionNumbers':[s['number'] for s in p.get('sections',[])],'questions':len(p.get('questions',[])),'collection':p.get('collection','uncatalogued'),'legacy':not row['payload'],'authoredRuntime':bool(p.get('authoredRuntime')),'completed':0,'started':False})
            return {'cards':cards,'hasMore':len(rows)>24,'unavailable':False}
        if kind=='speaking-manage':
            rows = await materials(con,user,True)
            prompts = [camel(r) for r in await con.fetch('SELECT id,part,topic,left(prompt_text,200) prompt_text,cue_card,follow_ups,available_in,publication_state,study_support FROM speaking_prompts ORDER BY part,created_at LIMIT 20000')] if user['role'] in ('admin','owner') else []
            return {'rows':rows,'canCompose':True,'canCreate':True,'prompts':prompts}
        if kind=='video-admin':
            scope = 'WHERE v.created_by_user_id=$1' if user['role']=='teacher' else ''
            rows = await con.fetch(f'''SELECT v.id,v.title,l.title lesson_title,v.provider,v.transcript_source,
              v.notes IS NOT NULL AND length(trim(v.notes))>0 has_notes,v.publication_state,v.publish_at
              FROM video_lessons v LEFT JOIN lessons l ON l.id=v.lesson_id {scope} ORDER BY v.created_at DESC LIMIT 5000''',*([user['id']] if scope else []))
            lessons = await con.fetch('SELECT id,title FROM lessons ORDER BY title,id LIMIT 5000')
            return {'lessons':[camel(r) for r in lessons],'authored':[camel(r) for r in rows]}
    raise HTTPException(404,'not_found')
