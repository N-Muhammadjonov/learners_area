"""In-place lesson block reconciler: source content/lessons.ts writeLessonBlocks.

Kept blocks retain primary keys (and all learner responses); only content changes
produce inserts/removals. Non-live revisions use this, while live rows are untouched.
"""
import json
from .step29_lesson_revision import snapshot_block

def rowvals(b,pos):
    ref=b.get('ref') or {};quiz=b.get('quiz')
    return {'position':pos,'type':b['type'],'text_content':b.get('text'),'link_url':b.get('url'),'object_key':b.get('objectKey'),
            'original_name':b.get('originalName'),'mime_type':b.get('mimeType'),'size':b.get('size'),
            'ref_module':ref.get('module'),'ref_content_type':ref.get('contentType'),'ref_source_ref':ref.get('sourceRef'),
            'ref_content_version_id':ref.get('versionId'),'quiz_question_type':quiz.get('questionType') if quiz else None,
            'quiz_payload':{'prompt':quiz['prompt'],'options':quiz.get('options'),'answer':quiz['answer'],'explanation':quiz.get('explanation')} if quiz else None}

def signature(r):
    return json.dumps([r.get(k) for k in ('type','text_content','link_url','object_key','ref_module','ref_content_type','ref_source_ref','ref_content_version_id','quiz_question_type','quiz_payload')],sort_keys=True,default=str)

async def insert(con,id,v):
    await con.execute('''INSERT INTO lesson_blocks(lesson_id,position,type,text_content,link_url,object_key,original_name,mime_type,size,
        ref_module,ref_content_type,ref_source_ref,ref_content_version_id,quiz_question_type,quiz_payload)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)''',id,v['position'],v['type'],v['text_content'],v['link_url'],
        v['object_key'],v['original_name'],v['mime_type'],v['size'],v['ref_module'],v['ref_content_type'],v['ref_source_ref'],
        v['ref_content_version_id'],v['quiz_question_type'],json.dumps(v['quiz_payload']) if v['quiz_payload'] else None)

async def reconcile_blocks(con,id,blocks):
    existing=[dict(x) for x in await con.fetch('SELECT * FROM lesson_blocks WHERE lesson_id=$1 ORDER BY position',id)]
    used=set();plan=[]
    for index,block in enumerate(blocks,1):
        values=rowvals(block,index)
        match=next((x for x in existing if str(x['id']) not in used and signature(x)==signature(values)),None)
        if match:used.add(str(match['id']))
        plan.append((values,match))
    for old in existing:
        if str(old['id']) not in used:await con.execute('DELETE FROM lesson_blocks WHERE id=$1',old['id'])
    for idx,(_,old) in enumerate((pair for pair in plan if pair[1]),1):
        await con.execute('UPDATE lesson_blocks SET position=$2 WHERE id=$1',old['id'],-idx)
    for values,old in plan:
        if old:continue
        await insert(con,id,values)
    for v,old in plan:
        if old:
            await con.execute('''UPDATE lesson_blocks SET position=$2,type=$3,text_content=$4,link_url=$5,object_key=$6,
                  original_name=$7,mime_type=$8,size=$9,ref_module=$10,ref_content_type=$11,ref_source_ref=$12,
                  ref_content_version_id=$13,quiz_question_type=$14,quiz_payload=$15::jsonb WHERE id=$1''',old['id'],v['position'],v['type'],
                  v['text_content'],v['link_url'],v['object_key'],v['original_name'],v['mime_type'],v['size'],v['ref_module'],v['ref_content_type'],
                  v['ref_source_ref'],v['ref_content_version_id'],v['quiz_question_type'],json.dumps(v['quiz_payload']) if v['quiz_payload'] else None)
