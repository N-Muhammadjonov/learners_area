"""Explicit administrative revisions from main; never run on startup or learner reads."""
import copy,hashlib,json,re
from uuid import UUID
from .dictionary_canonical import stable
from .dictionary_presentation import meaning_hash
from .step40_dictionary_storage import validate_entry
from .auth_validation import length
from .js_text import slice as js_slice
from .retention_authoring_port import content
from .step30_video_lexical import sentence_at


def sha(value):return hashlib.sha256(value.encode()).hexdigest()

def project_id(kind,key):
    value=bytearray(hashlib.sha256(('learners-area-dictionary-v1:'+kind+':'+key).encode()).digest()[:16])
    value[6]=(value[6]&15)|80;value[8]=(value[8]&63)|128
    return str(UUID(bytes=bytes(value)))

def translation_content_hash(sense):return sha(stable({'definitionUz':sense['definition_uz'],'translations':sense['translations']}))


def revise_dictionary_translations(entries,plan):
    if not isinstance(plan,dict) or set(plan)!={'version','status','rows'} or plan['version']!=1 or plan['status']!='ai_editorial_draft_not_published' or not isinstance(plan['rows'],list) or not plan['rows']:
        raise ValueError('translation_revision_invalid')
    result={entry['lexeme_id']:entry for entry in entries};seen=set()
    if len(result)!=len(entries):raise ValueError('duplicate_dictionary_entry')
    for row in plan['rows']:
        if not isinstance(row,dict) or set(row)!={'entryId','senseId','meaningSha','beforeTranslationSha','translationUz','definitionUz','reason'}:
            raise ValueError('translation_revision_invalid')
        for key in ('entryId','senseId'):
            try:UUID(row[key])
            except (TypeError,ValueError):raise ValueError('translation_revision_invalid')
        if any(not isinstance(row[k],str) or not re.fullmatch('[a-f0-9]{64}',row[k]) for k in ('meaningSha','beforeTranslationSha')):
            raise ValueError('translation_revision_invalid')
        for key,minimum,maximum in [('translationUz',1,6000),('definitionUz',1,6000),('reason',12,None)]:
            value=row.get(key)
            if not isinstance(value,str) or length(value.strip())<minimum or maximum is not None and length(value.strip())>maximum:
                raise ValueError('translation_revision_invalid')
        if row['senseId'] in seen:raise ValueError('duplicate_translation_revision')
        seen.add(row['senseId']);current=result.get(row['entryId'])
        sense=next((s for s in current['senses'] if s['sense_id']==row['senseId']),None) if current else None
        if not sense or meaning_hash(current,sense)!=row['meaningSha'] or translation_content_hash(sense)!=row['beforeTranslationSha']:
            raise ValueError('translation_revision_source_changed')
        next_entry=copy.deepcopy(current);target=next(s for s in next_entry['senses'] if s['sense_id']==row['senseId'])
        target['definition_uz']=row['definitionUz'].strip();target['translations'][0]['text']=row['translationUz'].strip()
        old=target.get('editorial',{})
        target['editorial']={'status':old.get('status','owner_supplied'),'translation_status':'ai_draft',
            'reference_urls':old.get('reference_urls',[]),'provenance':old.get('provenance','canonical_dictionary')+';explicit_uz_translation_revision'}
        validate_entry(next_entry);result[next_entry['lexeme_id']]=next_entry
    return list(result.values())


async def revise_retention_wording(con,plan,actor_user_id):
    required={'version','revision','sourceVersionId','nextVersionId','bodySha','structureSha','start','before','after','nextBodySha','reason'}
    if not isinstance(plan,dict) or set(plan)!=required or plan['version']!=1 or not isinstance(plan['revision'],str) or not re.fullmatch('[a-z0-9][a-z0-9_-]{0,59}',plan['revision']):
        raise ValueError('retention_revision_invalid')
    for key in ('sourceVersionId','nextVersionId'):
        try:UUID(plan[key])
        except (ValueError,TypeError):raise ValueError('retention_revision_invalid')
    if any(not isinstance(plan[k],str) or not re.fullmatch('[a-f0-9]{64}',plan[k]) for k in ('bodySha','structureSha','nextBodySha')):raise ValueError('retention_revision_invalid')
    if type(plan['start']) is not int or plan['start']<0:raise ValueError('retention_revision_invalid')
    for key,minimum in [('before',1),('after',1),('reason',12)]:
        if not isinstance(plan[key],str) or not minimum<=length(plan[key].strip() if key=='reason' else plan[key])<=1000:raise ValueError('retention_revision_invalid')
    if plan['nextVersionId']!=project_id('retention-source-revision',plan['revision']+'|'+plan['sourceVersionId']):raise ValueError('retention_revision_identity_changed')
    async with con.transaction():
        actor=await con.fetchrow('SELECT role,account_status FROM users WHERE id=$1',UUID(actor_user_id))
        if not actor or actor['account_status']!='active' or actor['role'] not in ('admin','owner'):raise ValueError('retention_revision_forbidden')
        original=await con.fetchrow('SELECT * FROM retention_text_versions WHERE id=$1',UUID(plan['sourceVersionId']))
        if not original:raise ValueError('retention_revision_source_changed')
        structure=original['scoring_structure'];structure=json.loads(structure) if isinstance(structure,str) else structure
        body=original['body_text'];end=plan['start']+length(plan['before'])
        if sha(body)!=plan['bodySha'] or sha(stable(structure))!=plan['structureSha'] or js_slice(body,plan['start'],end)!=plan['before']:raise ValueError('retention_revision_source_changed')
        parent=await con.fetchrow('SELECT * FROM retention_texts WHERE id=$1 FOR UPDATE',original['retention_text_id'])
        if not parent or not parent['active']:raise ValueError('retention_revision_source_not_current')
        await con.execute('SELECT pg_advisory_xact_lock(hashtext($1))','retention.version:'+str(parent['id']))
        body=js_slice(body,0,plan['start'])+plan['after']+js_slice(body,end)
        if sha(body)!=plan['nextBodySha'] or body==original['body_text']:raise ValueError('retention_revision_body_changed')
        checked,count,_=content(parent['level'],body,structure)
        if checked!=body:raise ValueError('retention_revision_body_changed')
        existing=await con.fetchrow('SELECT * FROM retention_text_versions WHERE id=$1',UUID(plan['nextVersionId']))
        if existing:
            existing_structure=existing['scoring_structure'];existing_structure=json.loads(existing_structure) if isinstance(existing_structure,str) else existing_structure
            if existing['retention_text_id']!=parent['id'] or existing['body_text']!=body or sha(stable(existing_structure))!=plan['structureSha']:raise ValueError('retention_revision_identity_conflict')
            if parent['current_version_id']!=existing['id']:raise ValueError('retention_revision_source_not_current')
            return {'created':False,'originalVersionId':str(original['id']),'versionId':str(existing['id']),'versionNumber':existing['version_number']}
        if parent['current_version_id']!=original['id']:raise ValueError('retention_revision_source_not_current')
        occurrences=await con.fetch("SELECT * FROM lexical_occurrences WHERE source_type='retention' AND retention_text_version_id=$1",original['id'])
        delta=length(plan['after'])-length(plan['before']);copied=[]
        for row in occurrences:
            if js_slice(original['body_text'],row['start_char'],row['end_char'])!=row['surface_form']:raise ValueError('retention_revision_occurrence_changed')
            if row['start_char']<end and row['end_char']>plan['start']:raise ValueError('retention_revision_occurrence_overlap')
            start=row['start_char']+delta if row['start_char']>=end else row['start_char'];stop=row['end_char']+delta if row['end_char']>=end else row['end_char']
            if js_slice(body,start,stop)!=row['surface_form']:raise ValueError('retention_revision_occurrence_changed')
            text_before=js_slice(body,0,start);prefix_index=len(text_before);tail_index=len(js_slice(body,0,stop))
            copied.append({**dict(row),'id':UUID(project_id('retention-revision-occurrence',plan['nextVersionId']+'|'+str(row['id']))),
                'retention_text_version_id':UUID(plan['nextVersionId']),'start_char':start,'end_char':stop,'sentence_text':sentence_at(body,prefix_index,tail_index)})
        number=1+await con.fetchval('SELECT coalesce(max(version_number),0)::int FROM retention_text_versions WHERE retention_text_id=$1',parent['id'])
        await con.execute('INSERT INTO retention_text_versions(id,retention_text_id,version_number,body_text,word_count,scoring_structure,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)',UUID(plan['nextVersionId']),parent['id'],number,body,count,json.dumps(structure),UUID(actor_user_id))
        for row in copied:
            columns=list(row);names=','.join('"'+name+'"' for name in columns);arguments=','.join('$'+str(i+1) for i in range(len(columns)))
            await con.execute('INSERT INTO lexical_occurrences('+names+') VALUES('+arguments+')',*[row[k] for k in columns])
        await con.execute('UPDATE retention_texts SET current_version_id=$2,updated_at=now() WHERE id=$1',parent['id'],UUID(plan['nextVersionId']))
        metadata={'revision':plan['revision'],'originalVersionId':str(original['id']),'versionId':plan['nextVersionId'],'version':number,'wordCount':count,'revisionManifestSha':sha(stable(plan)),'copiedOccurrences':len(copied)}
        await con.execute("INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata) VALUES($1,'retention_text.version_created','retention_text',$2,$3::jsonb)",UUID(actor_user_id),str(parent['id']),json.dumps(metadata))
        return {'created':True,'originalVersionId':str(original['id']),'versionId':plan['nextVersionId'],'versionNumber':number}
