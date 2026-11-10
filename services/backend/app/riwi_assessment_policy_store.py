"""Persistence for the existing Owner overlay workflow; never raw prompt policy."""
from __future__ import annotations
import hashlib
import json
from .riwi_assessment_contracts import (ASSESSMENT_POLICY_SCOPES, AssessmentPolicyError,
    owner_policy_contracts_for_scope, run_assessment_policy_regression, validate_owner_overlay)
from .riwi_audit import record_riwi_audit
from .riwi_capabilities import authorize_capability


def require_owner(actor):
    if actor.role != 'owner' or not authorize_capability(actor,'riwi.knowledge.approve').allowed:
        raise PermissionError('forbidden')


def policy_hash(scope,overlay):
    data={'scope':scope,'overlay':overlay,'contracts':[(c.key,c.version,c.rubric_version)
          for c in owner_policy_contracts_for_scope(scope)]}
    return hashlib.sha256(json.dumps(data,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def preview(scope,overlay):
    if scope not in ASSESSMENT_POLICY_SCOPES:
        raise AssessmentPolicyError('invalid_scope')
    overlay=validate_owner_overlay(overlay)
    regression=run_assessment_policy_regression(scope,overlay)
    return {'ok':True,'scope':scope,'overlay':overlay,'contentHash':policy_hash(scope,overlay),'regression':regression}


def decoded(value):
    return json.loads(value) if isinstance(value,str) else value


def present(row):
    return {'id':str(row['id']),'scope':row['scope'],'version':row['version'],'state':str(row['state']),
            'overlay':decoded(row['overlay']),'contentHash':policy_hash(row['scope'],decoded(row['overlay']))}


async def create(conn,actor,scope,overlay):
    require_owner(actor)
    check=preview(scope,overlay)
    if not check['regression']['passed']:
        raise AssessmentPolicyError('regression_failed')
    async with conn.transaction():
        await conn.execute('''INSERT INTO riwi_assessment_policies(scope,created_by_user_id)
            VALUES($1,$2::uuid) ON CONFLICT(scope) DO NOTHING''',scope,actor.id)
        parent=await conn.fetchrow('SELECT id FROM riwi_assessment_policies WHERE scope=$1 FOR UPDATE',scope)
        old=await conn.fetchrow('''SELECT v.*,p.scope FROM riwi_assessment_policy_versions v
            JOIN riwi_assessment_policies p ON p.id=v.policy_id
            WHERE v.policy_id=$1 AND v.source_message_hash=$2''',parent['id'],check['contentHash'])
        if old:
            return {'ok':True,'policyVersion':present(old),'reused':True}
        number=await conn.fetchval('SELECT COALESCE(MAX(version),0)+1 FROM riwi_assessment_policy_versions WHERE policy_id=$1',parent['id'])
        await record_riwi_audit(conn,actor_user_id=actor.id,action='riwi.assessment_policy.created',
            target_type='riwi_assessment_policy',target_id=str(parent['id']),metadata={'role':actor.role,'scope':scope,'status':'candidate'})
        row=await conn.fetchrow('''INSERT INTO riwi_assessment_policy_versions
            (policy_id,version,state,overlay,source_message_hash,created_by_user_id)
            VALUES($1,$2,'candidate',$3::jsonb,$4,$5::uuid) RETURNING *''',parent['id'],number,
            json.dumps(check['overlay']),check['contentHash'],actor.id)
        return {'ok':True,'policyVersion':present({**dict(row),'scope':scope}),'reused':False}


async def review(conn,actor,version_id,expected_hash,decision):
    require_owner(actor)
    if decision not in ('approve','reject','rollback') or not isinstance(expected_hash,str) or len(expected_hash)!=64:
        raise AssessmentPolicyError('exact_hash_required')
    async with conn.transaction():
        # Lock parent before version in every path to prevent approval/create deadlock.
        identity=await conn.fetchrow('SELECT policy_id FROM riwi_assessment_policy_versions WHERE id=$1::uuid',version_id)
        if not identity:raise LookupError('not_found')
        parent=await conn.fetchrow('SELECT * FROM riwi_assessment_policies WHERE id=$1 FOR UPDATE',identity['policy_id'])
        row=await conn.fetchrow('SELECT * FROM riwi_assessment_policy_versions WHERE id=$1::uuid FOR UPDATE',version_id)
        overlay=decoded(row['overlay']);scope=parent['scope']
        if policy_hash(scope,overlay)!=expected_hash:
            raise AssessmentPolicyError('stale_policy_hash')
        if decision=='reject':
            if row['state']!='candidate':raise AssessmentPolicyError('invalid_policy_state')
        elif decision=='approve':
            if row['state']!='candidate':raise AssessmentPolicyError('invalid_policy_state')
        elif row['state'] not in ('approved','superseded'):
            raise AssessmentPolicyError('invalid_rollback_source')
        proof=run_assessment_policy_regression(scope,overlay)
        if not proof['passed']:raise AssessmentPolicyError('regression_failed')
        await record_riwi_audit(conn,actor_user_id=actor.id,action='riwi.assessment_policy.'+decision,
            target_type='riwi_assessment_policy',target_id=version_id,metadata={'role':actor.role,'scope':scope,'status':decision})
        if decision=='reject':
            await conn.execute("UPDATE riwi_assessment_policy_versions SET state='rejected',reviewed_by_user_id=$2::uuid WHERE id=$1::uuid",version_id,actor.id)
            return {'ok':True,'versionId':version_id,'state':'rejected'}
        if decision=='rollback':
            number=await conn.fetchval('SELECT MAX(version)+1 FROM riwi_assessment_policy_versions WHERE policy_id=$1',parent['id'])
            # Existing UNIQUE(policy_id,source_message_hash) binds content identity.
            # A rollback gets a new hash bound to its new version and source.
            rollback_hash=hashlib.sha256(f'rollback:{version_id}:{number}:{expected_hash}'.encode()).hexdigest()
            row=await conn.fetchrow('''INSERT INTO riwi_assessment_policy_versions
                (policy_id,version,state,overlay,source_message_hash,created_by_user_id)
                VALUES($1,$2,'candidate',$3::jsonb,$4,$5::uuid) RETURNING *''',parent['id'],number,json.dumps(overlay),rollback_hash,actor.id)
        await conn.execute("UPDATE riwi_assessment_policy_versions SET state='superseded' WHERE policy_id=$1 AND state='approved'",parent['id'])
        await conn.execute('''UPDATE riwi_assessment_policy_versions SET state='approved',reviewed_by_user_id=$2::uuid,
            approved_at=NOW(),regression_fixture_id=$3,regression_evidence_hash=$4,regression_passed_at=NOW()
            WHERE id=$1::uuid''',str(row['id']),actor.id,proof['fixtureId'],proof['evidenceHash'])
        await conn.execute('UPDATE riwi_assessment_policies SET active_version=$2,updated_at=NOW() WHERE id=$1',parent['id'],row['version'])
        return {'ok':True,'versionId':str(row['id']),'state':'approved','version':row['version'],'rolledBack':decision=='rollback'}


async def active(conn,key):
    row=await conn.fetchrow('''SELECT p.scope,v.version,v.overlay FROM riwi_assessment_policies p
        JOIN riwi_assessment_policy_versions v ON v.policy_id=p.id AND v.version=p.active_version
        WHERE v.state='approved' AND (p.scope=$1 OR (right(p.scope,2)='.*' AND $1 LIKE replace(p.scope,'*','%')))
        ORDER BY length(p.scope) DESC LIMIT 1''',key)
    return (decoded(row['overlay']),row['scope'],row['version']) if row else (None,None,None)
