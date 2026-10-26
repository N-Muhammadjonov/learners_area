"""Owner-only Dictionary GET operations: summary/search/entry/drafts/history/publish.
Never makes a write, loads verified dictionary releases through the same read adapters.
"""
from __future__ import annotations
import json,re
from fastapi import APIRouter,Request
from . import main as core
from .db import row_to_dict
from .step17_dictionary_read_port import active_release,pinned,entry,error_response,normalize_search,worker
from .step21_dictionary_entry_save import present
router=APIRouter()
HEAD={'Cache-Control':'private, no-store'}

async def search(con,q,direction,release):
    norm=normalize_search(q)
    if not norm or len(norm)>80:return []
    initial=direction+':'+norm[0]
    w=await con.fetchrow('''SELECT coalesce(descriptor->'routes'->$2,descriptor->'routes'->$3,
      CASE WHEN descriptor->'routes' IS NULL THEN descriptor->'directory' END) AS directory
      FROM dictionary_search_indexes WHERE release_id=$1''',release,initial,direction+':*')
    if w:
        directory=w['directory']
        if not directory:return []
        p=await worker({'action':'search','release':release,'directory':directory,'query':q,'direction':direction})
        if isinstance(p,dict):
            if p.get('release_id')!=release:raise ValueError('dictionary_worker_unavailable')
            return p.get('results',[])
        if not isinstance(p,list):raise ValueError('dictionary_worker_unavailable')
        return p
    registry=await con.fetchrow('SELECT state,delivery FROM dictionary_releases WHERE id=$1',release)
    if not registry or registry['state']!='validated' or registry['delivery']!='legacy':
        raise ValueError('dictionary_worker_unavailable')
    pat=re.sub(r'([\\%_])',r'\\\1',norm)+'%'
    rows=await con.fetch('''WITH hits AS (
     SELECT lexeme_id,min(CASE WHEN term=$3 THEN rank ELSE 3 END) score
     FROM dictionary_search_terms WHERE release_id=$1 AND direction=$2 AND term LIKE $4 ESCAPE '\\' GROUP BY lexeme_id), picked AS (
     SELECT e.lexeme_id,e.payload,e.search_preview,e.part_of_speech,h.score FROM hits h
     JOIN dictionary_entries e ON e.release_id=$1 AND e.lexeme_id=h.lexeme_id
     ORDER BY h.score,e.lemma_norm,e.lexeme_id LIMIT 20)
     SELECT lexeme_id,coalesce(search_preview->>'display_lemma',payload->>'display_lemma') display_lemma,
     part_of_speech,coalesce(CASE WHEN $2='UZ' THEN (SELECT t->>'text' FROM jsonb_array_elements(search_preview->'uz_terms') t
     WHERE t->>'norm' LIKE $4 ESCAPE '\\' ORDER BY CASE WHEN t->>'norm'=$3 THEN 0 ELSE 1 END,t->>'norm' LIMIT 1) END,
     search_preview->>'translation_uz',payload#>>'{senses,0,translations,0,text}') translation_uz,
     CASE score WHEN 0 THEN 'exact_lemma' WHEN 1 THEN 'canonical_normalized' WHEN 2 THEN 'form'
     ELSE 'prefix' END match_type FROM picked''',release,direction,norm,pat)
    return [row_to_dict(r) for r in rows]

async def summary(con):
    ch=await active_release(con);r=await con.fetchrow('SELECT id,state,manifest,manifest_sha,validated_at FROM dictionary_releases WHERE id=$1',ch['active_release_id'])
    drafts=await con.fetchval("SELECT count(*)::int FROM dictionary_drafts WHERE state='draft'")
    baseline=await con.fetchrow("""SELECT id,manifest FROM dictionary_releases WHERE id IN
      ('rel-v1-a834010a6ccc72c8b3cd8db9','rel-v1-606b65c5282a75647c9928c3')
      AND state IN ('validated','retired') ORDER BY CASE WHEN id='rel-v1-606b65c5282a75647c9928c3' THEN 0 ELSE 1 END LIMIT 1""")
    manifest=r['manifest'] if r else None
    if isinstance(manifest,str):manifest=json.loads(manifest)
    bm=baseline['manifest'] if baseline else None
    if isinstance(bm,str):bm=json.loads(bm)
    if isinstance(manifest,dict) and isinstance(manifest.get('storage'),dict) and manifest['storage'].get('search'):
        c=await con.fetchrow('SELECT count(*) FILTER (WHERE is_custom)::int AS lexemes FROM dictionary_entries WHERE release_id=$1',ch['active_release_id'])
        custom={'lexemes':int(c['lexemes'] or 0),'senses':max(0,int(manifest.get('senses',0))-int((bm or {}).get('senses',0)))}
    else:
        c=await con.fetchrow('''SELECT count(*) FILTER (WHERE coalesce((search_preview->>'custom')::boolean,
            payload->'attribution' @> '[{"source_name":"Learners Area"}]'::jsonb))::int lexemes
            FROM dictionary_entries WHERE release_id=$1''',ch['active_release_id'])
        counts=await con.fetchrow('''SELECT coalesce(sum((SELECT count(*) FROM unnest(coalesce(e.sense_ids,
              ARRAY(SELECT (s->>'sense_id')::uuid FROM jsonb_array_elements(e.payload->'senses') s))) id
              WHERE id NOT IN (SELECT unnest(coalesce(b.sense_ids,
              ARRAY(SELECT (s->>'sense_id')::uuid FROM jsonb_array_elements(b.payload->'senses') s)))
              FROM dictionary_entries b WHERE b.release_id=$2 AND b.lexeme_id=e.lexeme_id))),0)::int AS senses
              FROM dictionary_entries e WHERE e.release_id=$1''',ch['active_release_id'],baseline['id'] if baseline else 'rel-v1-606b65c5282a75647c9928c3')
        custom={'lexemes':int(c['lexemes'] or 0),'senses':int(counts['senses'] or 0)}
    published=await con.fetchrow('''SELECT created_at FROM dictionary_owner_events WHERE result_release_id=$1
      AND operation IN ('activate_release','rollback_release') ORDER BY created_at DESC LIMIT 1''',ch['active_release_id'])
    return {'channel':row_to_dict(ch),'release':row_to_dict(r) if r else None,'drafts':int(drafts or 0),'custom':custom,
      'published_at':row_to_dict(published)['created_at'] if published else row_to_dict(r)['validated_at'] if r else None,
      'index_state':'validated' if r and r['state']=='validated' else 'pending'}

@router.get('/api/owner/dictionary/{action:path}')
async def dictionary_owner_read(req:Request,action:str):
    user=await core.current_user(req,active=True)
    if not user or user['role']!='owner':return core.j({'error':'forbidden'},403,HEAD)
    parts=action.split('/')
    if not (parts in (['summary'],['search'],['drafts'],['history'],['publish'])
      or len(parts)==2 and parts[0]=='entries' and core.uuid_value(parts[1])):
        return core.j({'error':'not_found'},404)
    try:
        db=await core.pool()
        async with db.acquire() as con:
            if parts==['summary']:result=await summary(con)
            elif parts==['search']:
                q=req.query_params.get('q','');direction=req.query_params.get('direction','EN')
                if len(q)>80 or direction not in ('EN','UZ'):return core.j({'error':'invalid_input'},400)
                release=await pinned(con)
                result={'release_id':release,'results':await search(con,q,direction,release)}
            elif len(parts)==2 and parts[0]=='entries' and core.uuid_value(parts[1]):
                release=await pinned(con,req.query_params.get('release_id'))
                value=await entry(con,core.uuid_value(parts[1]),release)
                result={'entry':value,'presentation':present(value) if value else None}
            elif parts==['drafts']:
                rows=await con.fetch('''SELECT id,base_release_id,changes,state,created_at
                    FROM dictionary_drafts WHERE owner_user_id=$1 AND state='draft' ORDER BY created_at DESC LIMIT 100''',user['id'])
                result={'drafts':[row_to_dict(r) for r in rows]}
            elif parts==['history']:
                rows=await con.fetch('''SELECT id,operation,entity_id,base_release_id,candidate_release_id,result_release_id,
                   validation_result,created_at FROM dictionary_owner_events ORDER BY created_at DESC LIMIT 50''')
                result={'history':[row_to_dict(r) for r in rows]}
            elif parts==['publish']:
                job=await con.fetchrow('''SELECT id,phase,error,candidate_release_id FROM dictionary_publish_jobs
                    WHERE owner_user_id=$1 ORDER BY updated_at DESC LIMIT 1''',user['id'])
                result={'job':row_to_dict(job) if job else None}
            else:return core.j({'error':'not_found'},404)
        return core.j(result,headers=HEAD)
    except Exception as exc:return error_response(exc)

def install():core.app.include_router(router)
