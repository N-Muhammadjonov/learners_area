"""Global Search, preserving the source's 12 independently settled content categories,
identity-based dictionary hits, bilingual navigation and final stable ranking.
Source: src/app/api/search/route.ts, src/lib/search/{content,navigation}.ts
"""
from __future__ import annotations
import asyncio
import json
import re
import unicodedata
from pathlib import Path
from urllib.parse import quote, urlencode
from fastapi import APIRouter, Request
from . import main as core
from .rate_limit import RULES, counter
from .step17_dictionary_read_port import pinned
from .step26_dictionary_owner_read import search as search_dict

router = APIRouter()
PRIVATE = {'Cache-Control':'private, no-store'}
RULES.setdefault('global_search',(300,60))
LANG = json.loads(Path(__file__).with_name('search_nav_i18n.json').read_text())
WRITING_TABS = ('lessons','exam','translation','typing','topic-vocabulary','grade','activation','language-stealing')
SPEAKING_HUB = (('lessons','/app/speaking/lessons'),('partner','/app/speaking/live-partner'),('practice','/app/speaking/practice'),('ai','/app/speaking/ai'))
MODULES = ('listening','reading','writing','grammar','vocabulary','video-lessons')
READING = ('lessons','academic','general','retention')
APOSTROPHES = str.maketrans({c:"'" for c in '\u2018\u2019\u02bb\u02bc`\u00b4\u2032'})
OMISSIONS = (
 ('reading105:test:08','t08-p2-european-heat-wave',14),
 ('reading105:test:12','t12-p1-how-printed-books-began',14),
 ('reading105:test:30','t30-p1-the-terracotta-army',16),
 ('reading105:test:31','t31-p1-this-is-very-much-the-story-of-a-story',14),
)


def norm(v):
    return re.sub(r'\s+',' ', unicodedata.normalize('NFKC',v or '').lower().translate(APOSTROPHES)).strip()


def excerpt(value):
    value = value or ''
    return value[:107]+'…' if len(value)>110 else value


def hit(type_,title,context,href):
    return {'type':type_, 'title':title, 'context':context, 'href':href}


def nav_entries(lang):
    d = LANG[lang]; nav=d['nav']; out=[]
    for mod in MODULES:
        out.append(hit('module',nav['videoLessons'] if mod=='video-lessons' else nav[mod],None,f'/app/{mod}'))
    out.append(hit('module',nav['speaking'],None,'/app/speaking'))
    for mod in MODULES:
        context=nav['videoLessons'] if mod=='video-lessons' else nav[mod]
        if mod=='vocabulary':
            for key in ('words','revision','games','use','board','dictionary'):
                href='/app/vocabulary/games' if key=='games' else '/app/vocabulary' if key=='words' else f'/app/vocabulary?tab={key}'
                out.append(hit('section',d['vocabulary']['tab'][key],context,href))
        elif mod=='reading':
            for key in READING:
                out.append(hit('section',d['readingV4']['products'][key]['title'],context,f'/app/reading/{key}'))
        elif mod=='listening':
            for key,href in (('lessons','/app/listening/lessons'),('academic','/app/listening/tests'),('mcqProgram','/app/listening/mcq')):
                out.append(hit('section',d['listening'][key]['title'],context,href))
        elif mod=='grammar':
            for label,href in (('lessonsTitle','/app/grammar/lessons'),('forWriting','/app/grammar?tab=writing'),('forSpeaking','/app/grammar?tab=speaking')):
                out.append(hit('section',d['grammar'][label],context,href))
    for tab in WRITING_TABS:
        out.append(hit('section',d['writingWorkspace']['tabs'][tab],nav['writing'],f'/app/writing?tab={tab}'))
    for key,href in SPEAKING_HUB:
        out.append(hit('section',d['speakingHub']['cards'][key]['title'],nav['speaking'],href))
    return out


def navigation_search(query,locale):
    needle=norm(query)
    if len(needle)<2:return []
    bilingual={e['href'] for language in ('en','uz') for e in nav_entries(language) if needle in norm(e['title']+' '+(e['context'] or ''))}
    return [e for e in nav_entries(locale) if e['href'] in bilingual]


def rank_search(hits,query,limit=30):
    n=norm(query)
    unique={}
    for e in hits:unique.setdefault((e['type'],e['href'],e['title']),e)
    def score(e):
        title=norm(e['title'])
        return (0 if title==n else 1 if title.startswith(n) else 2,len(e['title']),e['href'])
    return sorted(unique.values(),key=score)[:limit]

LIVE = "({alias}.publication_state='published' OR ({alias}.publication_state='scheduled' AND {alias}.publish_at<=NOW()))"
DELETED = "NOT EXISTS (SELECT 1 FROM activity_events deleted_content WHERE deleted_content.id=md5('deleted-content:' || {alias}.id::text)::uuid AND deleted_content.type='CONTENT_DELETED')"


def pub(alias):
    return LIVE.format(alias=alias)+' AND '+DELETED.format(alias=alias)


def escape_like(query):
    return '%'+re.sub(r'([\\%_])',r'\\\1',query)+'%'


async def category(con,kind,like,user_id):
    # Each category's query is independent: Promise.allSettled preserves useful
    # categories even when another table is temporarily unavailable.
    if kind==0:
        rows=await con.fetch(f'''SELECT p.id,p.title,g.set_id,g.passage_no FROM reading_passages p
        JOIN general_reading_passages g ON g.passage_id=p.id JOIN general_reading_sets s ON s.id=g.set_id
        WHERE {pub('p')} AND {pub('s')} AND p.title ILIKE $1
        ORDER BY p.title,p.id LIMIT 5''',like)
        return [hit('reading',r['title'],'General Reading',f"/app/reading/general/{r['set_id']}?passage={r['passage_no']}") for r in rows]
    if kind==1:
        clause=' OR '.join(f"(s.source_ref='{ref}' AND EXISTS(SELECT 1 FROM reading_questions q JOIN reading_passages p ON p.id=q.passage_id JOIN general_reading_passages g ON g.passage_id=p.id WHERE g.set_id=s.id AND p.external_id='{external}' AND q.question_no={num}))" for ref,external,num in OMISSIONS)
        rows=await con.fetch(f'''SELECT s.id,s.title FROM general_reading_sets s WHERE {pub('s')} AND s.title ILIKE $1
        AND ((SELECT count(*) FROM reading_questions q JOIN general_reading_passages g ON g.passage_id=q.passage_id WHERE g.set_id=s.id)=40
        OR (to_regclass('public.reading_assessment_questions') IS NOT NULL AND
        (SELECT count(*) FROM reading_questions q JOIN general_reading_passages g ON g.passage_id=q.passage_id WHERE g.set_id=s.id)=41 AND ({clause})))
        AND (SELECT count(*) FROM general_reading_passages g WHERE g.set_id=s.id)=3
        AND NOT EXISTS (SELECT 1 FROM general_reading_passages g JOIN reading_passages p ON p.id=g.passage_id WHERE g.set_id=s.id AND
         (g.passage_no NOT IN (1,2,3) OR NOT ({pub('p')})))
        ORDER BY s.title,s.id LIMIT 5''',like)
        return [hit('reading',r['title'],'Academic Reading',f"/app/reading/academic/{r['id']}") for r in rows]
    if kind==2:
        product='''CASE WHEN t.program_ref IS NOT NULL THEN 'mcq_programme'
          WHEN p.payload->>'collection'='mcq' THEN 'mcq_programme'
          WHEN p.payload->>'collection'='question_types' THEN 'question_type_practice'
          WHEN p.payload->>'collection'='essential' THEN 'essential_recording'
          WHEN p.payload->>'collection'='academic' THEN 'academic_full_test'
          WHEN p.payload->>'collection'='general' THEN 'general_section'
          WHEN p.test_id IS NOT NULL AND coalesce(jsonb_array_length(p.payload->'sections'),0)=4 AND coalesce(jsonb_array_length(p.payload->'questions'),0)=40 THEN 'academic_full_test'
          WHEN p.test_id IS NULL AND (SELECT v.content_type FROM content_versions v WHERE v.module='listening' AND v.target_id=t.id ORDER BY v.version_no DESC LIMIT 1)='full_test' THEN 'academic_full_test'
          WHEN p.test_id IS NULL AND (SELECT v.content_type FROM content_versions v WHERE v.module='listening' AND v.target_id=t.id ORDER BY v.version_no DESC LIMIT 1)='section' THEN 'general_section'
          ELSE 'unclassified' END'''
        rows=await con.fetch(f'''SELECT t.id,t.title,t.program_ordinal day,({product}) product
        FROM listening_tests t LEFT JOIN listening_packages p ON p.test_id=t.id
        WHERE {pub('t')} AND t.title ILIKE $1 AND
          (({product})='general_section' OR (p.test_id IS NOT NULL AND ({product})<>'unclassified') OR t.program_ordinal IS NOT NULL)
        ORDER BY t.title,t.id LIMIT 5''',like)
        return [hit('listening',r['title'],None,f"/app/listening/mcq/day/{r['day']}" if r['day'] else f"/app/listening/general/{r['id']}" if r['product']=='general_section' else f"/app/listening/tests/{r['id']}") for r in rows]
    if kind==3:
        rows=await con.fetch('''SELECT l.term,l.definition_en FROM user_vocabulary v JOIN lexemes l ON l.id=v.lexeme_id
        WHERE v.user_id=$1 AND (l.term ILIKE $2 OR l.translation_uz ILIKE $2) ORDER BY l.term,v.id LIMIT 5''',user_id,like)
        return [hit('vocabulary',r['term'],excerpt(r['definition_en']),'/app/vocabulary?q='+quote(r['term'],safe='')) for r in rows]
    if kind==4:
        rows=await con.fetch(f'''SELECT l.id,l.title,l.learning_area FROM lessons l WHERE {pub('l')} AND l.title ILIKE $1
        ORDER BY l.title,l.id LIMIT 5''',like)
        return [hit('lesson',r['title'],r['learning_area'],f"/app/{r['learning_area']}/lessons/{r['id']}" if r['learning_area'] in ('reading','listening','grammar') else f"/app/courses/ielts/lessons/{r['id']}") for r in rows]
    if kind==5:
        rows=await con.fetch(f"SELECT t.id,t.title FROM grammar_topics t WHERE t.publication_state='published' AND {DELETED.format(alias='t')} AND t.title ILIKE $1 ORDER BY t.title,t.id LIMIT 5",like)
        return [hit('grammar',r['title'],None,f"/app/grammar/{r['id']}") for r in rows]
    if kind==6:
        rows=await con.fetch(f'''SELECT w.id,w.prompt,w.task_type FROM writing_prompts w WHERE {pub('w')} AND
        (w.prompt ILIKE $1 OR w.category ILIKE $1) ORDER BY w.id LIMIT 5''',like)
        return [hit('writing',excerpt(r['prompt']),'Task 1' if r['task_type']=='task1' else 'Task 2',f"/app/writing/prompts/{r['id']}") for r in rows]
    if kind==7:
        rows=await con.fetch(f'''SELECT s.id,s.title,s.category FROM speaking_materials s WHERE {pub('s')}
        AND s.category<>'shadowing' AND s.title ILIKE $1 ORDER BY s.title,s.id LIMIT 5''',like)
        return [hit('speaking',r['title'],r['category'],f"/app/speaking/lessons#material-{r['id']}") for r in rows]
    if kind==8:
        rows=await con.fetch(f'''SELECT p.id,p.prompt_text,p.part,p.topic FROM speaking_prompts p
        WHERE {pub('p')} AND p.part IN ('part1','part2','part3')
        AND (p.available_in @> '["practice_alone"]'::jsonb OR p.available_in @> '["live_partner"]'::jsonb)
        AND (p.prompt_text ILIKE $1 OR p.topic ILIKE $1) ORDER BY p.id LIMIT 5''',like)
        def context_href(r):
            return '/app/speaking/practice?'+urlencode({'part':r['part'],'topic':r['topic'].strip().lower() if r['topic'] and r['topic'].strip() else '__untitled__'})
        return [hit('speaking',excerpt(r['prompt_text']),r['topic'],context_href(r)) for r in rows]
    if kind==9:
        rows=await con.fetch(f'''SELECT v.id,v.title FROM video_lessons v WHERE {pub('v')} AND v.title ILIKE $1 ORDER BY v.title,v.id LIMIT 5''',like)
        return [hit('video',r['title'],'TED / Podcast',f"/app/video-lessons/{r['id']}") for r in rows]
    if kind==10:
        rows=await con.fetch('''SELECT c.title,c.status FROM live_classes c JOIN courses s ON s.id=c.course_id
        WHERE s.slug='ielts' AND c.status<>'cancelled' AND c.title ILIKE $1 ORDER BY c.id LIMIT 5''',like)
        return [hit('liveClass',r['title'],r['status'],'/app/live-classes') for r in rows]
    if kind==11:
        rows=await con.fetch('''SELECT a.id,a.title FROM assignments a WHERE a.target_user_id=$1
        AND (a.title ILIKE $2 OR a.description ILIKE $2) ORDER BY a.id LIMIT 5''',user_id,like)
        return [hit('assignment',r['title'],None,f"/app/assignments/{r['id']}") for r in rows]
    raise ValueError('unknown category')


async def content_search(query,user_id):
    like=escape_like(query)
    db=await core.pool()
    async def run(kind):
        async with db.acquire() as con:
            return await category(con,kind,like,user_id)
    settled=await asyncio.gather(*(run(i) for i in range(12)),return_exceptions=True)
    return {'results':[e for v in settled if not isinstance(v,BaseException) for e in v],
            'failedCategories':sum(isinstance(v,BaseException) for v in settled)}


async def dictionary_search_hits(query):
    db=await core.pool()
    async with db.acquire() as con:
        release=await pinned(con)
    async def run(direction):
        async with db.acquire() as con:
            return await search_dict(con,query,direction,release)
    two=await asyncio.gather(run('EN'),run('UZ'))
    seen=set();hits=[]
    for idx,items in enumerate(two):
        for entry in items[:5]:
            identifier=str(entry['lexeme_id'])
            if identifier in seen:continue
            seen.add(identifier)
            hits.append(hit('dictionary',entry['display_lemma'],entry.get('translation_uz'),'/app/vocabulary?'+urlencode({'tab':'dictionary','q':query,'direction':'UZ' if idx else 'EN','entry':identifier})))
    return hits


@router.get('/api/search')
async def global_search(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.j({'error':'unauthenticated'},401,PRIVATE)
    retry=counter('global_search','global-search:'+str(user['id']),consume=True)
    if retry:return core.j({'error':'rate_limited'},429,{**PRIVATE,'Retry-After':str(retry)})
    q=(req.query_params.get('q') or '').strip()[:64]
    if len(q)<2:return core.j({'query':q,'results':[],'tooShort':True},headers=PRIVATE)
    lang=req.cookies.get('la_locale')
    locale=lang if lang in ('en','uz') else 'uz'
    nav=navigation_search(q,locale)
    content,dict_result=await asyncio.gather(content_search(q,str(user['id'])),dictionary_search_hits(q),return_exceptions=True)
    partial=isinstance(content,BaseException) or (not isinstance(content,BaseException) and content['failedCategories']>0) or isinstance(dict_result,BaseException)
    combined=nav+(content['results'] if not isinstance(content,BaseException) else [])+(dict_result if not isinstance(dict_result,BaseException) else [])
    ranked=rank_search(combined,q)
    if partial and not ranked:return core.j({'error':'search_unavailable'},503,PRIVATE)
    return core.j({'query':q,'results':ranked,'partial':partial},headers=PRIVATE)


def install():core.app.include_router(router)
