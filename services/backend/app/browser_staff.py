"""Role-gated staff presentation reads, separate from the private SQL adapter."""
import os
from datetime import datetime, timezone
from urllib.parse import urlencode
from fastapi import HTTPException
from . import main as core
from .browser_common import camel, existing, identifier, live, number, require_role
from .step21_safe_reads_port import OWNER, get_owner

ADMIN = ('admin','owner')
STAFF = ('teacher','admin','owner')
TEACHER_OWNER = ('teacher','owner')
BRAND = {'logoMasterDark':'learners-area-logo-master-dark.png','logoMarkDark':'Learners_Area_V11_Exact_Cutout_Logo.png','logoMarkLight':'owner-neon-day.png','logoHorizontalDark':'learners-area-logo-horizontal-dark.png','logoHorizontalLight':'learners-area-logo-horizontal-light.png','favicon':'learners-area-favicon.png'}


async def integrations(con):
    from .owner_ai_control_port import status
    checked = datetime.now(timezone.utc).isoformat()
    await con.fetchval('SELECT 1')
    def row(key, configured, detail=None, connected=False):
        return {'key':key,'state':'connected' if connected else 'unverified' if configured else 'not_configured','detail':detail,'checkedAt':checked}
    storage = os.getenv('STORAGE_PROVIDER','local').lower()
    conf = (await status())['effective']
    return [row('database',True,connected=True),row('storage',all(os.getenv(k) for k in ('R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_ENDPOINT','R2_BUCKET_NAME')), 'local disk (development provider)' if storage=='local' else 'provider credentials configured; live access unverified',storage=='local'),
      row('telegram',bool(os.getenv('TELEGRAM_BOT_TOKEN') or os.getenv('TELEGRAM_BOT_USERNAME'))),
      row('email',any(os.getenv(k) for k in ('EMAIL_PROVIDER','SMTP_URL','RESEND_API_KEY'))),
      row('external_ai',conf['externalEnabled'] and conf['providerIsExternal']),row('speech_to_text',os.getenv('STT_PRIMARY_PROVIDER','none').lower()!='none')]


async def managed_owners(con, user, kind, count=False):
    if kind not in OWNER: raise HTTPException(404,'not_found')
    table,title,creator = OWNER[kind]
    clauses,args = [],[]
    if creator and (user['role']=='teacher' or (kind=='live_class' and user['role']!='owner')):
        clauses.append(f'{creator}=$1');args.append(user['id'])
    if kind in ('reading','listening','writing','speaking'):
        clauses.append("NOT EXISTS(SELECT 1 FROM activity_events d WHERE d.id=md5('deleted-content:'||x.id::text)::uuid AND d.type='CONTENT_DELETED')")
    scope = ' WHERE '+' AND '.join(clauses) if clauses else ''
    if count: return await con.fetchval(f'SELECT count(*)::int FROM {table} x'+scope,*args)
    visible = live('x') if kind in ('reading','listening','writing','speaking') else 'TRUE'
    if kind=='speaking': visible+=' AND x.is_active'
    rows = await con.fetch(f'SELECT id,left(trim(COALESCE({title},\'\')),120) title,({visible}) student_visible FROM {table} x'+scope+f' ORDER BY {title},id LIMIT 5000',*args)
    return [camel(r) for r in rows]


async def route_view(req, user, path, q):
    if path == '/app/owner/audit':
        require_role(user,('owner',))
        db = await core.pool()
        async with db.acquire() as con:
            return {'rows':[camel(r) for r in await con.fetch('SELECT id,action,target_type,target_id,created_at FROM audit_log ORDER BY created_at DESC LIMIT 100')]}
    if path == '/app/admin/materials':
        require_role(user,STAFF)
        db = await core.pool()
        async with db.acquire() as con:
            return {'counts':[{'type':kind,'total':await managed_owners(con,user,kind,True)} for kind in OWNER]}
    if path == '/app/admin/content':
        require_role(user,ADMIN)
        db = await core.pool()
        async with db.acquire() as con:
            inventory = {}
            for kind,table in (('reading','reading_passages'),('listening','listening_tests'),('writing','writing_prompts'),('grammar','grammar_topics'),('video','video_lessons')):
                # Grammar topics have no scheduling column in the target schema.
                predicate = "publication_state='published'" if kind=='grammar' else live()
                inventory[kind] = dict(await con.fetchrow(f'SELECT count(*)::int total,count(*) FILTER (WHERE {predicate})::int live FROM {table}'))
            other = {'total':0,'live':0}
            for table in ('writing_lessons','writing_translation_sets','writing_model_texts','writing_language_patterns'):
                r = await con.fetchrow(f'SELECT count(*)::int total,count(*) FILTER (WHERE {live()})::int live FROM {table}')
                other = {k:other[k]+r[k] for k in other}
            return {'inventory':inventory,'writingOther':other}
    raise HTTPException(404,'not_found')


async def read_staff(req, user, kind):
    q = dict(req.query_params)
    if kind.startswith('owner-'):
        require_role(user,('owner',))
    elif kind in ('student-results','centre-statistics'):
        require_role(user,('owner',))
    elif kind in ('teacher-live-classes','teacher-live-class'):
        # Centre-wide administrators may manage their own assigned classes, but do not
        # receive global Owner-level read access to other teachers' classes or rosters.
        require_role(user,STAFF)
    elif kind in ('teacher-students','teacher-student','teacher-homework','teacher-actions','teacher-assignment','teacher-assessment','student-learning','mock-grading'):
        require_role(user,TEACHER_OWNER)
    elif kind in ('admissions','people','roster','grammar-topics','grammar-topic','reading-passages','reading-passage','listening-library','listening-test','listening-import','reading-retention','retention-staged','writing-admin','writing-admin-new','writing-admin-item'):
        require_role(user,ADMIN)
    else:
        require_role(user,STAFF)
    if kind == 'mock-grading':
        from .mock_system_port import build_staff_mock_queue
        db = await core.pool()
        async with db.acquire() as con:
            return await build_staff_mock_queue(con, user, q)
    if kind in ('admissions','people','roster','student-results','support-inbox','teacher-live-classes','teacher-live-class'):
        from .browser_staff_people import read
        return await read(req,user,kind,q)
    if kind in ('teacher-students','teacher-student','teacher-homework','teacher-actions','teacher-assignment','teacher-assessment'):
        from .browser_staff_academic import read
        return await read(req,user,kind,q)
    if kind in ('grammar-topics','grammar-topic','reading-passages','reading-passage','listening-library','listening-test','listening-import','speaking-manage','video-admin','writing-admin','writing-admin-new','writing-admin-item','retention-staged'):
        from .browser_staff_content import read
        return await read(req,user,kind,q)
    if kind in ('centre-statistics','student-learning'):
        from .browser_statistics import read
        return await read(req,user,kind,q)
    if kind == 'reading-retention':
        level = q.get('level','A2')
        if level not in ('A2','B1','B2','C1','C2'): raise HTTPException(400,'invalid_level')
        flt,sort = q.get('filter','active'),q.get('sort','label')
        raw = await existing(req,'/api/admin/retention/texts?'+urlencode({'level':level,'filter':flt,'sort':sort,'page':q.get('page','1')}))
        return {'inventory':raw['inventory'],'level':level,'filter':flt,'sort':sort,'bank':{k:raw[k] for k in ('page','pageCount','total','rows')}}
    db = await core.pool()
    async with db.acquire() as con:
        if kind == 'materials-kind': return {'rows':await managed_owners(con,user,q.get('type'))}
        if kind == 'materials-owner':
            type = q.get('type'); id = identifier(q.get('id'))
            owner = await get_owner(con,type,str(id))
            if not owner or (user['role']=='teacher' or (type=='live_class' and user['role']!='owner')) and owner['creatorId'] and str(owner['creatorId'])!=str(user['id']): raise HTTPException(404,'not_found')
            if type == 'live_class' and user['role'] != 'owner' and not owner.get('creatorId'): raise HTTPException(404,'not_found')
            return {'owner':{'title':owner['title'],'studentVisible':owner['studentVisible']}}
        if kind == 'owner-overview':
            counts = [dict(r) for r in await con.fetch('SELECT role,account_status status,count(*)::int count FROM users GROUP BY role,account_status')]
            pending = await con.fetchval("SELECT count(*)::int FROM users WHERE account_status='pending'")
            from .browser_statistics import owner_academic_overview
            academic = await owner_academic_overview(con,q)
            return {'userCounts':counts,'pendingAdmissions':pending,'academic':academic}
        if kind == 'owner-integrations': return {'services':await integrations(con)}
        if kind == 'owner-retention': return await existing(req,'/api/owner/retention')
        if kind == 'owner-transfer':
            candidates = [camel(r) for r in await con.fetch("SELECT id,name,email,role FROM users WHERE account_status='active' AND id<>$1 AND role IN ('admin','teacher') ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END,name,email LIMIT 200",user['id'])]
            return {'currentOwner':{'id':str(user['id']),'name':user['name'],'email':user['email']},'candidates':candidates}
    raise HTTPException(404,'not_found')
