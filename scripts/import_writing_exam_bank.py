"""Emit an idempotent owner-attributed Writing question import, dry run by default.

No connection or startup mutation. Deploy private graph assets before applying SQL.
"""
import argparse
import json
from pathlib import Path
import sys
from uuid import UUID,uuid5

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'services/backend'))
from app.step25_content_version import version_hashes


def generate(actor,apply=False):
    data=json.loads((ROOT/'services/backend/app/writing_exam_bank.json').read_text())
    actor=str(UUID(actor))
    for p in data['prompts']:
        snapshot={k:p[k] for k in ('prompt','taskType','category','image','isNew','sourceDate','addedDate','dateDetail')}
        snapshot['wordMinimum']=150 if p['taskType']=='task1' else 250
        snapshot['visual']=p['image']
        p['snapshot']=snapshot
        p['hashes']=version_hashes('writing',p['taskType'],snapshot)
        p['versionId']=str(uuid5(UUID(p['id']),'initial-content-version'))
    payload=json.dumps(data,ensure_ascii=False,separators=(',',':'))
    assert '$exam_bank$' not in payload
    return '''BEGIN;
SET LOCAL lock_timeout='5s';
DO $import$
DECLARE
  bank jsonb := $exam_bank$'''+payload+'''$exam_bank$::jsonb;
  actor uuid := '''+"'"+actor+"'"+'''::uuid;
  p jsonb;
  before_counts jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=actor AND role='owner' AND account_status='active') THEN
    RAISE EXCEPTION 'Active owner required';
  END IF;
  SELECT jsonb_build_array((SELECT count(*) FROM writing_exam_papers),(SELECT count(*) FROM writing_submissions)) INTO before_counts;
  FOR p IN SELECT value FROM jsonb_array_elements(bank->'prompts') LOOP
    INSERT INTO writing_prompts(id,task_type,category,prompt,target_word_count,is_active,publication_state,source_ref)
    VALUES((p->>'id')::uuid,(p->>'taskType')::writing_task_type,p->>'category',p->>'prompt',
      CASE WHEN p->>'taskType'='task1' THEN 150 ELSE 250 END,true,(p->>'publicationState')::publication_state,p->>'sourceRef')
    ON CONFLICT(id) DO NOTHING;
    IF NOT EXISTS(SELECT 1 FROM writing_prompts w WHERE w.id=(p->>'id')::uuid
      AND w.prompt=p->>'prompt' AND w.task_type::text=p->>'taskType' AND w.category=p->>'category'
      AND w.source_ref=p->>'sourceRef' AND w.is_active AND w.publication_state::text=p->>'publicationState') THEN
      RAISE EXCEPTION 'Question identity conflict: %',p->>'sourceKey';
    END IF;
    IF p->'image' <> 'null'::jsonb THEN
      INSERT INTO resource_blocks(id,owner_type,owner_id,position,type,object_key,original_name,mime_type,size,created_by_user_id)
      VALUES((p->'image'->>'resourceId')::uuid,'writing',(p->>'id')::uuid,1,'image',p->'image'->>'objectKey',
        p->'image'->>'originalName','image/png',(p->'image'->>'size')::integer,actor) ON CONFLICT(id) DO NOTHING;
      IF NOT EXISTS(SELECT 1 FROM resource_blocks r WHERE r.id=(p->'image'->>'resourceId')::uuid
        AND r.owner_type='writing' AND r.owner_id=(p->>'id')::uuid AND r.type='image'
        AND r.object_key=p->'image'->>'objectKey' AND r.size=(p->'image'->>'size')::integer AND r.mime_type='image/png') THEN
        RAISE EXCEPTION 'Visual binding conflict: %',p->>'sourceKey';
      END IF;
    END IF;
    INSERT INTO content_versions(id,module,content_type,source_ref,version_no,status,title,track,content_hash,semantic_hash,
      answer_key_hash,publication_state,target_type,target_id,created_by_user_id,change_kind,provenance,content_snapshot,published_at)
    VALUES((p->>'versionId')::uuid,'writing',p->>'taskType',p->>'sourceRef',1,
      (CASE WHEN p->>'publicationState'='published' THEN 'published' ELSE 'draft' END)::content_version_status,
      p->>'code','academic',p->'hashes'->>'content_hash',p->'hashes'->>'semantic_hash',p->'hashes'->>'answer_key_hash',
      p->>'publicationState','writing_prompt',(p->>'id')::uuid,actor,'created',
      jsonb_build_object('origin','owner-provided-html','source',bank->'source','dateMeaning','Reported source date; not an independently verified sitting'),
      p->'snapshot',CASE WHEN p->>'publicationState'='published' THEN NOW() ELSE NULL END) ON CONFLICT(id) DO NOTHING;
    IF NOT EXISTS(SELECT 1 FROM content_versions v WHERE v.id=(p->>'versionId')::uuid
      AND v.content_snapshot=p->'snapshot' AND v.target_id=(p->>'id')::uuid) THEN
      RAISE EXCEPTION 'Content version conflict: %',p->>'sourceKey';
    END IF;
  END LOOP;
  IF before_counts IS DISTINCT FROM jsonb_build_array((SELECT count(*) FROM writing_exam_papers),(SELECT count(*) FROM writing_submissions)) THEN
    RAISE EXCEPTION 'Existing learner work changed';
  END IF;
  INSERT INTO audit_log(id,actor_user_id,action,target_type,target_id,metadata)
  VALUES('5948b9d6-4712-414f-8ec3-411d785c809a',actor,'WRITING_EXAM_BANK_IMPORTED','writing_source',bank->'source'->>'sha256',
    jsonb_build_object('source',bank->'source','questions',jsonb_array_length(bank->'prompts'))) ON CONFLICT(id) DO NOTHING;
END $import$;
'''+('COMMIT;\n' if apply else 'ROLLBACK;\n')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--actor',required=True)
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();args.output.write_text(generate(args.actor,args.apply))
