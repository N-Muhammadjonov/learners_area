"""Current sentence-only Translation answer; canonical matches are checked without AI.
AI outages persist as unchecked rather than fabricated evaluations.
"""
from __future__ import annotations
import json,math,re,unicodedata
from fastapi import APIRouter,Request
from . import main as core
from . import step23_writing_provider as ai
from .writing_translation_port import done,translation_view
from .rate_limit import evaluation_limit
router=APIRouter()

def norm(s):
    t=unicodedata.normalize('NFKC',s).lower().translate(str.maketrans({'\u2018':"'",'\u2019':"'",'\u02bc':"'",'`':"'",'\u201c':'"','\u201d':'"','\u2013':'-','\u2014':'-'}))
    return re.sub(r'\s+',' ',re.sub(r'[.,;:!?"]+',' ',t)).strip()

def invalid():return core.j({'error':{'code':'invalid_input','message':'Write your English sentence first.','field':'answer'}},400)

def problem(code):
    return core.j({'error':{'code':code,'message':'This sentence is not the current one.' if code=='not_current' else 'Could not check this sentence.'}},404 if code=='not_found' else 400 if code=='empty' else 409)

@router.post('/api/writing/translation/{id}/answer')
async def submit(req:Request,id:str):
    user=await core.current_user(req,active=True)
    if not user:return core.j({'error':{'code':'unauthenticated','message':'Sign in again.'}},401)
    limited=await evaluation_limit(user['id'],lightweight=True)
    if limited is not None:return limited
    b=await core.payload(req)
    if not core.uuid_value(id) or not isinstance(b,dict) or set(b)!={'position','answer'} or type(b.get('position')) is not int or not 1<=b['position']<=40 or not isinstance(b.get('answer'),str) or len(b['answer'])>1200:return invalid()
    text=b['answer'].strip()
    if not text:return problem('empty')
    db=await core.pool()
    async with db.acquire() as con:
        attempt=await con.fetchrow('SELECT * FROM writing_translation_attempts WHERE id=$1 AND user_id=$2',core.uuid_value(id),user['id'])
        if not attempt:return problem('not_found')
        if attempt['status']=='completed':return problem('completed')
        sentences=await con.fetch('SELECT * FROM writing_translation_sentences WHERE set_id=$1 ORDER BY position',attempt['set_id'])
        previous=await con.fetch('SELECT * FROM writing_translation_answers WHERE attempt_id=$1',attempt['id'])
        old={str(a['sentence_id']):dict(a) for a in previous}
        current=next((s for s in sentences if not done(old.get(str(s['id'])))),None)
        if current is None or current['position']!=b['position']:return problem('not_current')
        eqs=[current['model_english'],*(current['accepted_alternatives'] or [])]
        rec={'answer':text,'evaluation_status':'exact','verdict':'correct','meaning':100,'grammar':None,'vocabulary':None,'feedback':None,'improved':None}
        needs_ai=not norm(text) or not any(norm(t)==norm(text) for t in eqs)
        doc=await con.fetchrow('SELECT target_band FROM writing_translation_sets WHERE id=$1',attempt['set_id']) if needs_ai else None
    if needs_ai:
        r,error=await ai.check(user.get('locale','en'),'translation',{'kind':'translation','uzbekSource':current['uzbek_source'],'referenceEnglish':current['model_english'],'acceptedAlternatives':current['accepted_alternatives'] or [],'targetBand':doc['target_band'],'answer':text},user_id=user['id'])
        if error:
            rec.update(evaluation_status='unavailable',verdict=None,meaning=None)
        else:
            rec.update(evaluation_status='evaluated',verdict=r['verdict'],meaning=round(r['bands']['meaning']/9*100) if r['bands']['meaning'] is not None else None,
                       grammar=r['bands']['grammar'],vocabulary=r['bands']['vocabulary'],feedback=r['feedback'],improved=r['improved'])
    async with db.acquire() as con:
        prev=old.get(str(current['id']));tries=(prev['tries'] if prev else 0)+1
        await con.execute('''INSERT INTO writing_translation_answers(attempt_id,sentence_id,answer_text,evaluation_status,verdict,meaning_preserved,grammar_band,vocabulary_band,feedback,improved_version,tries)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(attempt_id,sentence_id) DO UPDATE
             SET answer_text=excluded.answer_text,evaluation_status=excluded.evaluation_status,verdict=excluded.verdict,
                 meaning_preserved=excluded.meaning_preserved,grammar_band=excluded.grammar_band,vocabulary_band=excluded.vocabulary_band,
                 feedback=excluded.feedback,improved_version=excluded.improved_version,tries=excluded.tries''',attempt['id'],current['id'],text,rec['evaluation_status'],rec['verdict'],rec['meaning'],rec['grammar'],rec['vocabulary'],rec['feedback'],rec['improved'],tries)
        old[str(current['id'])]={**rec,'answer_text':text,'tries':tries,'meaning_preserved':rec['meaning'],'grammar_band':rec['grammar'],'vocabulary_band':rec['vocabulary'],'improved_version':rec['improved']}
        if all(done(old.get(str(s['id']))) for s in sentences):
            vals=[old[str(s['id'])] for s in sentences]
            doc=await con.fetchrow('SELECT target_band FROM writing_translation_sets WHERE id=$1',attempt['set_id'])
            target=float(doc['target_band'])
            def average(items):return sum(items)/len(items) if items else None
            checked=[v for v in vals if v['evaluation_status']!='unavailable']
            grammar=average([float(v['grammar_band'] if v['evaluation_status']!='exact' else target) for v in checked if v['evaluation_status']=='exact' or v['grammar_band'] is not None])
            vocab=average([float(v['vocabulary_band'] if v['evaluation_status']!='exact' else target) for v in checked if v['evaluation_status']=='exact' or v['vocabulary_band'] is not None])
            meaning=average([v['meaning_preserved'] for v in vals if v['meaning_preserved'] is not None])
            half=lambda n:math.floor(n*2+0.5)/2
            await con.execute('''UPDATE writing_translation_attempts SET status='completed',completed_at=NOW(),
              elapsed_ms=(EXTRACT(EPOCH FROM(NOW()-started_at))*1000)::int,overall_estimate=$2,meaning_score=$3,grammar_band=$4,vocabulary_band=$5
              WHERE id=$1 AND status='in_progress' ''',attempt['id'],half((grammar+vocab)/2) if grammar is not None and vocab is not None else None,round(meaning) if meaning is not None else None,half(grammar) if grammar is not None else None,half(vocab) if vocab is not None else None)
    v=await translation_view(req,id)
    import json as jsonlib
    data=jsonlib.loads(v.body)
    return core.j({'ok':True,'verdict':'unchecked' if rec['evaluation_status']=='unavailable' else rec['verdict'],'view':data['view']})

def install():core.app.include_router(router)
