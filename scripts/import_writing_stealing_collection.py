"""Emit a reviewed source-only import; default ROLLBACK, never a startup import."""
import argparse,json,sys,uuid
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'services/backend'))
from app.step25_content_version import version_hashes

def generate(actor,apply=False):
    data=json.loads((ROOT/'services/backend/app/writing_stealing_collection.json').read_text())
    sha=data['source']['sha256'];ns=uuid.UUID('bbca2527-dd53-450a-822e-b44dc921d86d')
    uid=lambda key:str(uuid.uuid5(ns,sha+':'+key))
    versions=[]
    for m in data['models']:
        snapshot={k:m[k] for k in ('title','taskType','topic','targetBand','estimatedBand','body','wordCount','provenance','prompt','promptSource','promptSourceUrl','feedback')}
        versions.append({'id':uid('VERSION-'+m['sourceRef']),'contentType':'model_text','sourceRef':m['sourceRef'],'title':m['title'],'targetType':'writing_model_text','targetId':m['id'],'snapshot':snapshot,**version_hashes('writing','model_text',snapshot)})
    for p in data['patterns']:
        snapshot={k:p[k] for k in ('pattern','function','taskType','topic','targetBand','example','usageNote','provenance')}
        snapshot['modelTextId']=p['modelId']
        versions.append({'id':uid('VERSION-'+p['versionSourceRef']),'contentType':'pattern','sourceRef':p['versionSourceRef'],'title':p['pattern'],'targetType':'writing_pattern','targetId':p['id'],'snapshot':snapshot,**version_hashes('writing','pattern',snapshot)})
    assert len(data['models'])==15 and len(data['patterns'])==150 and len(versions)==165
    data.update(actor=str(uuid.UUID(actor)),auditId=uid('IMPORT-AUDIT'),versions=versions)
    raw=json.dumps(data,ensure_ascii=False,separators=(',',':'));assert '$stealing_source$' not in raw
    sql="""BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TEMP TABLE stealing_source_import ON COMMIT DROP AS SELECT $stealing_source$"""+raw+"""$stealing_source$::jsonb AS data;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM users WHERE id=(SELECT (data->>'actor')::uuid FROM stealing_source_import) AND role='owner' AND account_status='active')
 THEN RAISE EXCEPTION 'Verified active owner required'; END IF;
END $$;
CREATE TEMP TABLE stealing_source_before ON COMMIT DROP AS SELECT jsonb_build_object(
 'prompts',(SELECT count(*) FROM writing_prompts),'translations',(SELECT count(*) FROM writing_translation_sets),
 'sentences',(SELECT count(*) FROM writing_translation_sentences),'lessons',(SELECT count(*) FROM writing_lessons),
 'typing',(SELECT count(*) FROM typing_texts),'submissions',(SELECT count(*) FROM writing_submissions),
 'papers',(SELECT count(*) FROM writing_exam_papers),'translationAttempts',(SELECT count(*) FROM writing_translation_attempts),
 'sessions',(SELECT count(*) FROM writing_stealing_sessions),'savedPatterns',(SELECT count(*) FROM writing_pattern_bank)) AS counts;

INSERT INTO writing_model_texts(id,title,task_type,topic,target_band,body,word_count,provenance,publication_state,source_ref)
SELECT (m->>'id')::uuid,m->>'title','task2',m->>'topic',(m->>'targetBand')::numeric,m->>'body',
 (m->>'wordCount')::integer,m->>'provenance','published',m->>'sourceRef'
FROM stealing_source_import i CROSS JOIN LATERAL jsonb_array_elements(i.data->'models') m
ON CONFLICT (id) DO NOTHING;

INSERT INTO writing_language_patterns(id,pattern,function,task_type,topic,target_band,example,usage_note,provenance,publication_state,source_ref)
SELECT (p->>'id')::uuid,p->>'pattern',p->>'function','task2',p->>'topic',NULL,p->>'example',p->>'usageNote',
 p->>'provenance','published',p->>'modelId'
FROM stealing_source_import i CROSS JOIN LATERAL jsonb_array_elements(i.data->'patterns') p
ON CONFLICT (id) DO NOTHING;

INSERT INTO content_versions(id,module,content_type,source_ref,version_no,status,title,track,content_hash,semantic_hash,
 answer_key_hash,publication_state,target_type,target_id,created_by_user_id,change_kind,provenance,content_snapshot,published_at)
SELECT (v->>'id')::uuid,'writing',v->>'contentType',v->>'sourceRef',1,'published',v->>'title','academic',
 v->>'content_hash',v->>'semantic_hash',v->>'answer_key_hash','published',v->>'targetType',(v->>'targetId')::uuid,
 (i.data->>'actor')::uuid,'created',jsonb_build_object('origin','user-provided-document','source',i.data->'source',
 'bandMeaning','Model bands and feedback are estimates; individual chunks have no assigned band'),v->'snapshot',NOW()
FROM stealing_source_import i CROSS JOIN LATERAL jsonb_array_elements(i.data->'versions') v
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM stealing_source_import i CROSS JOIN LATERAL jsonb_array_elements(i.data->'models') m
 LEFT JOIN writing_model_texts w ON w.id=(m->>'id')::uuid
 WHERE w.source_ref IS DISTINCT FROM m->>'sourceRef' OR w.title IS DISTINCT FROM m->>'title'
 OR w.body IS DISTINCT FROM m->>'body' OR w.topic IS DISTINCT FROM m->>'topic'
 OR w.target_band IS DISTINCT FROM (m->>'targetBand')::numeric OR w.word_count IS DISTINCT FROM (m->>'wordCount')::integer
 OR w.provenance IS DISTINCT FROM m->>'provenance' OR w.task_type::text IS DISTINCT FROM 'task2' OR w.publication_state::text IS DISTINCT FROM 'published')
 THEN RAISE EXCEPTION 'Model identity conflict; existing content was not overwritten'; END IF;
 IF EXISTS (SELECT 1 FROM stealing_source_import i CROSS JOIN LATERAL jsonb_array_elements(i.data->'patterns') p
 LEFT JOIN writing_language_patterns w ON w.id=(p->>'id')::uuid
 WHERE w.source_ref IS DISTINCT FROM p->>'modelId' OR w.pattern IS DISTINCT FROM p->>'pattern'
 OR w.example IS DISTINCT FROM p->>'example' OR w.function IS DISTINCT FROM p->>'function'
 OR w.usage_note IS DISTINCT FROM p->>'usageNote' OR w.topic IS DISTINCT FROM p->>'topic'
 OR w.provenance IS DISTINCT FROM p->>'provenance' OR w.target_band IS NOT NULL
 OR w.task_type::text IS DISTINCT FROM 'task2' OR w.publication_state::text IS DISTINCT FROM 'published')
 THEN RAISE EXCEPTION 'Chunk identity conflict; existing content was not overwritten'; END IF;
 IF EXISTS (SELECT 1 FROM stealing_source_import i CROSS JOIN LATERAL jsonb_array_elements(i.data->'versions') v
 LEFT JOIN content_versions w ON w.id=(v->>'id')::uuid
 WHERE w.source_ref IS DISTINCT FROM v->>'sourceRef' OR w.target_id IS DISTINCT FROM (v->>'targetId')::uuid
 OR w.content_snapshot IS DISTINCT FROM v->'snapshot' OR w.content_hash IS DISTINCT FROM v->>'content_hash'
 OR w.semantic_hash IS DISTINCT FROM v->>'semantic_hash' OR w.answer_key_hash IS DISTINCT FROM v->>'answer_key_hash')
 THEN RAISE EXCEPTION 'Source version conflict'; END IF;
 IF (SELECT counts FROM stealing_source_before) IS DISTINCT FROM jsonb_build_object(
 'prompts',(SELECT count(*) FROM writing_prompts),'translations',(SELECT count(*) FROM writing_translation_sets),
 'sentences',(SELECT count(*) FROM writing_translation_sentences),'lessons',(SELECT count(*) FROM writing_lessons),
 'typing',(SELECT count(*) FROM typing_texts),'submissions',(SELECT count(*) FROM writing_submissions),
 'papers',(SELECT count(*) FROM writing_exam_papers),'translationAttempts',(SELECT count(*) FROM writing_translation_attempts),
 'sessions',(SELECT count(*) FROM writing_stealing_sessions),'savedPatterns',(SELECT count(*) FROM writing_pattern_bank))
 THEN RAISE EXCEPTION 'Unrelated content or learner work changed'; END IF;
END $$;

INSERT INTO audit_log(id,actor_user_id,action,target_type,target_id,metadata)
SELECT (data->>'auditId')::uuid,(data->>'actor')::uuid,'WRITING_STEALING_IMPORTED','writing_stealing_source',
 data->'source'->>'sha256',jsonb_build_object('source',data->'source','modelEssays',15,'linkedChunks',150,'estimatedBands',true)
FROM stealing_source_import ON CONFLICT(id) DO NOTHING;
SELECT jsonb_build_object('modelEssays',15,'linkedChunks',150,'sourceVersions',165) AS language_stealing_import;
"""
    migration=ROOT/'supabase/migrations/20261026110616_writing_model_pattern_capacity.sql'
    sql=sql.replace('\nINSERT INTO writing_model_texts', '\n'+migration.read_text()+'\nINSERT INTO writing_model_texts',1)
    return sql+('COMMIT;\n' if apply else 'ROLLBACK;\n')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--actor',required=True);p.add_argument('--apply',action='store_true');p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();a.output.write_text(generate(a.actor,a.apply))
