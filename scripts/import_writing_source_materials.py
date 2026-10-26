"""Generate an explicit, idempotent Writing content transaction, dry run by default.

This script never connects to a database and is never called at application startup.
Apply only the reviewed SQL after deploying its private graph handler and assets.
"""
import argparse
import json
from pathlib import Path
import sys
import uuid

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'services/backend'))
from app.step25_content_version import version_hashes

def generate(actor,apply=False):
    data=json.loads((ROOT/'services/backend/app/writing_source_materials.json').read_text())
    sha=data['source']['sha256'];ns=uuid.UUID('c78624b8-b38f-4c5f-8cdc-d54a0876164e')
    def uid(key):return str(uuid.uuid5(ns,sha+':'+key))
    versions=[]
    for p in data['prompts']:
        snapshot={'prompt':p['prompt'],'taskType':p['taskType'],'wordMinimum':p['targetWordCount'],'category':p['category'],'visual':p.get('image'),'practice':p['practice']}
        versions.append({'id':uid('VERSION-'+p['inventoryCode']),'contentType':p['taskType'],'sourceRef':p['sourceRef'],'title':p['inventoryCode'],'targetType':'writing_prompt','targetId':p['id'],'publicationState':p['publicationState'],'snapshot':snapshot,**version_hashes('writing',p['taskType'],snapshot)})
    for t in data['translations']:
        snapshot={k:t[k] for k in ('title','topic','questionType','taskType','targetBand','promptText')}
        snapshot['sentences']=[{'uzbekSource':t['uzbekSource'],'modelEnglish':t['modelEnglish'],'acceptedAlternatives':[],'notes':[],'targetLexicalItems':[]}]
        versions.append({'id':uid('VERSION-'+t['code']),'contentType':'translation_set','sourceRef':t['sourceRef'],'title':t['title'],'targetType':'writing_translation_set','targetId':t['id'],'publicationState':'published','snapshot':snapshot,**version_hashes('writing','translation_set',snapshot)})
    assert len(versions)==167 and len(data['prompts'])==110 and len(data['translations'])==57
    data['versions']=versions
    data['actor']=str(uuid.UUID(actor));data['auditId']=uid('IMPORT-AUDIT')
    raw=json.dumps(data,ensure_ascii=False,separators=(',',':'));assert '$writing_source$' not in raw
    sql="""BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TEMP TABLE writing_source_import ON COMMIT DROP AS SELECT $writing_source$"""+raw+"""$writing_source$::jsonb AS data;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=(SELECT (data->>'actor')::uuid FROM writing_source_import)
    AND role='owner' AND account_status='active') THEN RAISE EXCEPTION 'Verified active owner required'; END IF;
END $$;
CREATE TEMP TABLE writing_source_before ON COMMIT DROP AS SELECT jsonb_build_object(
 'papers',(SELECT count(*) FROM writing_exam_papers),
 'submissions',(SELECT count(*) FROM writing_submissions),
 'attempts',(SELECT count(*) FROM writing_translation_attempts),
 'lessons',(SELECT count(*) FROM writing_lessons),
 'models',(SELECT count(*) FROM writing_model_texts),
 'typing',(SELECT count(*) FROM typing_texts)) AS counts;

INSERT INTO writing_prompts(id,task_type,category,prompt,target_word_count,is_active,publication_state,source_ref)
SELECT (p->>'id')::uuid,(p->>'taskType')::writing_task_type,p->>'category',p->>'prompt',
 (p->>'targetWordCount')::integer,true,(p->>'publicationState')::publication_state,p->>'sourceRef'
FROM writing_source_import i CROSS JOIN LATERAL jsonb_array_elements(i.data->'prompts') p
ON CONFLICT (id) DO NOTHING;

INSERT INTO resource_blocks(id,owner_type,owner_id,position,type,object_key,original_name,mime_type,size,created_by_user_id)
SELECT (p->'image'->>'resourceId')::uuid,'writing',(p->>'id')::uuid,1,'image',
 p->'image'->>'objectKey',p->'image'->>'originalName','image/png',(p->'image'->>'size')::integer,(i.data->>'actor')::uuid
FROM writing_source_import i CROSS JOIN LATERAL jsonb_array_elements(i.data->'prompts') p WHERE p ? 'image'
ON CONFLICT (id) DO NOTHING;

INSERT INTO writing_translation_sets(id,title,topic,question_type,task_type,target_band,prompt_text,provenance,publication_state,source_ref)
SELECT (t->>'id')::uuid,t->>'title',t->>'topic',t->>'questionType','task2',8,t->>'promptText',
 'User-provided UZ-to-EN reference. Target band 8 is a study goal, not a certified score.','published',t->>'sourceRef'
FROM writing_source_import i CROSS JOIN LATERAL jsonb_array_elements(i.data->'translations') t
ON CONFLICT (id) DO NOTHING;

INSERT INTO writing_translation_sentences(id,set_id,position,uzbek_source,model_english,accepted_alternatives,notes,target_lexical_items)
SELECT (t->>'sentenceId')::uuid,(t->>'id')::uuid,1,t->>'uzbekSource',t->>'modelEnglish','[]','[]','[]'
FROM writing_source_import i CROSS JOIN LATERAL jsonb_array_elements(i.data->'translations') t
ON CONFLICT (id) DO NOTHING;

INSERT INTO content_versions(id,module,content_type,source_ref,version_no,status,title,track,
 content_hash,semantic_hash,answer_key_hash,publication_state,target_type,target_id,
 created_by_user_id,change_kind,provenance,content_snapshot,published_at)
SELECT (v->>'id')::uuid,'writing',v->>'contentType',v->>'sourceRef',1,
 (CASE WHEN v->>'publicationState'='published' THEN 'published' ELSE 'draft' END)::content_version_status,
 v->>'title','academic',v->>'content_hash',v->>'semantic_hash',v->>'answer_key_hash',v->>'publicationState',
 v->>'targetType',(v->>'targetId')::uuid,(i.data->>'actor')::uuid,'created',
 jsonb_build_object('origin','user-provided-document','source',i.data->'source',
 'targetBandMeaning','Learner study target, not a certified reference score'),v->'snapshot',
 CASE WHEN v->>'publicationState'='published' THEN NOW() ELSE NULL END
FROM writing_source_import i CROSS JOIN LATERAL jsonb_array_elements(i.data->'versions') v
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM writing_source_import i CROSS JOIN LATERAL jsonb_array_elements(i.data->'prompts') p
   LEFT JOIN writing_prompts w ON w.id=(p->>'id')::uuid
   WHERE w.source_ref IS DISTINCT FROM p->>'sourceRef' OR w.prompt IS DISTINCT FROM p->>'prompt'
    OR w.task_type::text IS DISTINCT FROM p->>'taskType' OR w.category IS DISTINCT FROM p->>'category'
    OR w.target_word_count IS DISTINCT FROM (p->>'targetWordCount')::integer
    OR w.publication_state::text IS DISTINCT FROM p->>'publicationState' OR NOT w.is_active)
 THEN RAISE EXCEPTION 'Prompt identity conflict: no existing content overwritten'; END IF;
 IF EXISTS (SELECT 1 FROM writing_source_import i CROSS JOIN LATERAL jsonb_array_elements(i.data->'prompts') p
   LEFT JOIN resource_blocks b ON b.id=(p->'image'->>'resourceId')::uuid WHERE p ? 'image' AND
   (b.object_key IS DISTINCT FROM p->'image'->>'objectKey' OR b.owner_id IS DISTINCT FROM (p->>'id')::uuid
    OR b.owner_type::text IS DISTINCT FROM 'writing' OR b.type::text IS DISTINCT FROM 'image'
    OR b.mime_type IS DISTINCT FROM 'image/png' OR b.size IS DISTINCT FROM (p->'image'->>'size')::integer))
 THEN RAISE EXCEPTION 'Graph binding conflict'; END IF;
 IF EXISTS (SELECT 1 FROM writing_source_import i CROSS JOIN LATERAL jsonb_array_elements(i.data->'translations') t
   LEFT JOIN writing_translation_sets s ON s.id=(t->>'id')::uuid
   LEFT JOIN writing_translation_sentences e ON e.id=(t->>'sentenceId')::uuid
   WHERE s.source_ref IS DISTINCT FROM t->>'sourceRef' OR s.title IS DISTINCT FROM t->>'title'
    OR s.prompt_text IS DISTINCT FROM t->>'promptText' OR s.topic IS DISTINCT FROM t->>'topic'
    OR s.question_type IS DISTINCT FROM t->>'questionType' OR s.target_band IS DISTINCT FROM 8
    OR s.publication_state::text IS DISTINCT FROM 'published' OR e.set_id IS DISTINCT FROM s.id
    OR e.uzbek_source IS DISTINCT FROM t->>'uzbekSource' OR e.model_english IS DISTINCT FROM t->>'modelEnglish')
 THEN RAISE EXCEPTION 'Translation identity conflict'; END IF;
 IF EXISTS (SELECT 1 FROM writing_source_import i CROSS JOIN LATERAL jsonb_array_elements(i.data->'versions') v
   LEFT JOIN content_versions c ON c.id=(v->>'id')::uuid WHERE c.target_id IS DISTINCT FROM (v->>'targetId')::uuid
    OR c.content_snapshot IS DISTINCT FROM v->'snapshot' OR c.source_ref IS DISTINCT FROM v->>'sourceRef'
    OR c.content_hash IS DISTINCT FROM v->>'content_hash' OR c.semantic_hash IS DISTINCT FROM v->>'semantic_hash')
 THEN RAISE EXCEPTION 'Version identity conflict'; END IF;
 IF (SELECT counts FROM writing_source_before) IS DISTINCT FROM jsonb_build_object(
 'papers',(SELECT count(*) FROM writing_exam_papers),'submissions',(SELECT count(*) FROM writing_submissions),
 'attempts',(SELECT count(*) FROM writing_translation_attempts),'lessons',(SELECT count(*) FROM writing_lessons),
 'models',(SELECT count(*) FROM writing_model_texts),'typing',(SELECT count(*) FROM typing_texts))
 THEN RAISE EXCEPTION 'Unrelated records changed'; END IF;
END $$;

INSERT INTO audit_log(id,actor_user_id,action,target_type,target_id,metadata)
SELECT (data->>'auditId')::uuid,(data->>'actor')::uuid,'WRITING_SOURCE_IMPORTED','writing_source',data->'source'->>'sha256',
 jsonb_build_object('source',data->'source','prompts',110,'publishedTask1',49,'heldTask1',6,'task2',55,'translations',57,'graphs',49)
FROM writing_source_import ON CONFLICT (id) DO NOTHING;
SELECT jsonb_build_object('sourcePrompts',110,'readyTask1',49,'heldTask1',6,'readyTask2',55,'sourceTranslationSets',57) AS writing_import;
"""
    return sql+('COMMIT;\n' if apply else 'ROLLBACK;\n')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--actor',required=True)
    parser.add_argument('--apply',action='store_true',help='Emit COMMIT instead of the default ROLLBACK')
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();args.output.write_text(generate(args.actor,args.apply))
