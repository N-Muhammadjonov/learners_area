"""Original bilingual answers and policy examples from synthetic Owner questions.

The corpus is routing data, never a permission grant or executable instruction.
Only exact normalised wording (or the same complete token set) selects a FAQ.
Numerals and negation are not discarded. Topic lessons retain activation checks.
"""
from functools import lru_cache
import json
from pathlib import Path
import re
from .riwi_uzbek import normalize_query

SOCIAL_RESPONSES={
    'presence':{'kind':'answer','uz':'Shu yerdaman, savolingizga yordam berishga tayyorman 🙂 Tushunmagan gap, mavzu yoki sayt bo‘yicha savolingizni yozing — birga ko‘rib chiqamiz.',
        'en':'I’m here and ready to help 🙂 Share a confusing sentence, topic or question about the website, and we can work through it.'},
    'wellbeing':{'kind':'answer','uz':'Yordam berishga tayyorman 🙂 O‘zingiz qalaysiz? Bugun qaysi savolni birga ko‘ramiz?',
        'en':'I’m ready to help 🙂 How are you? What would you like to work on today?'},
}
SOCIAL_QUERIES={**dict.fromkeys(('nima qilyapsan','nima qilyapsiz','sen nima qilyapsan','what are you doing'),'presence'),
    **dict.fromkeys(('qalaysan','qalaysiz','yaxshimisan','yaxshimisiz','how are you'),'wellbeing'),
    **dict.fromkeys(('salom','salom riwi','assalomu alaykum','hello','hi'),'greeting'),
    **dict.fromkeys(('rahmat','katta rahmat','thank you','thanks','xayr'),'thanks-bye')}


def key(text):
    return re.sub(r'\biltimos\b','',normalize_query(text)).strip()


@lru_cache(maxsize=1)
def library():
    data=json.loads((Path(__file__).resolve().parents[1]/'contracts/riwi_question_answers_v1.json').read_text())
    if data.get('version')!='riwi-question-answers-v1' or len(data.get('entries',[]))!=1640:
        raise ValueError('invalid_question_library')
    from .riwi_curriculum import library as curriculum
    for entry in data['entries']:
        if entry.get('lessonId'):
            if entry['lessonId'] not in curriculum():raise ValueError('unknown_question_lesson')
        else:
            response=data['responses'].get(entry.get('responseId'))
            if not response or any(not isinstance(response.get(k),str) or not response[k].strip() or len(response[k])>5800 for k in ('en','uz')):
                raise ValueError('invalid_question_answer')
            if entry['decision'] in ('deny','conditional') and response['kind']!=entry['decision']:
                raise ValueError('invalid_question_policy')
    return data


def response_for(profile):
    return SOCIAL_RESPONSES.get(profile) or library()['responses'].get(profile,{})


@lru_cache(maxsize=1)
def indexes():
    exact={};bags={}
    for e in library()['entries']:
        exact.setdefault(key(e['question']),[]).append(e)
        bag=frozenset(key(e['question']).split())
        if len(bag)>=5:bags.setdefault(bag,[]).append(e)
    return exact,bags


def match_question(message):
    query=key(message);exact,bags=indexes()
    matches=exact.get(query) or bags.get(frozenset(query.split()),[])
    if not matches:
        if query in SOCIAL_QUERIES:
            return {'id':'social.'+SOCIAL_QUERIES[query],'responseId':SOCIAL_QUERIES[query],'decision':'answer','semanticMatch':True}
        # Curated intent anchors allow mixed control language without treating
        # arbitrary token overlap as semantic similarity or dropping numbers.
        profiles=[(('although','despite'),'although-despite'),(('borrow','lend'),'borrow-lend'),
                  (('fun','funny'),'fun-funny'),(('big','large'),'large-big'),
                  (('job','work'),'job-work'),(('eventually','finally'),'eventually'),
                  (('look','forward'),'look-forward'),(('question','tag'),'question-tags')]
        words=set(query.split());candidates=[]
        if words & {'picnic','piknik','landscape'} and words & {'joy','joylar','joylarni','place','places','royxat','royxatini','tabiat'}:
            return {'id':'mixed.outdoor','responseId':'outdoor-plan','decision':'answer','semanticMatch':True}
        if words & {'farq','difference','explain','tushuntir','nima','qanday','vs','between','meaning'}:
            for anchors,profile in profiles:
                if all(a in words or a+'s' in words for a in anchors):candidates.append(profile)
        if len(set(candidates))==1:
            profile=candidates[0]
            return {**next(e for e in library()['entries'] if e.get('responseId')==profile),'semanticMatch':True}
        if query in ('who are you','what can you do','how can you help me','what is your name','sen kimsiz','siz kimsiz'):
            profile='platform' if 'help' in query or 'do' in query else 'identity'
            return next(e for e in library()['entries'] if e.get('responseId')==profile)
        return None
    # Collisions never weaken a restriction or choose between different answers.
    denied=[e for e in matches if e['decision']=='deny']
    if denied:return denied[0]
    conditional=[e for e in matches if e['decision']=='conditional']
    if conditional:return conditional[0]
    return matches[0] if len({(e.get('responseId'),e.get('lessonId')) for e in matches})==1 else None


def guard_profile(message):
    entry=match_question(message)
    if entry and not entry.get('semanticMatch'):
        response=response_for(entry.get('responseId'))
        return entry['responseId'] if response.get('kind')=='deny' else None
    q=normalize_query(message)
    request=bool(re.search(r'\b(?:korsat\w*|chiqar\w*|yubor\w*|ber|top\w*|och\w*|ayt\w*|reveal|dump|show|send|leak)\b',q))
    if not request:return None
    if re.search(r'\b(?:parol\w*|token\w*|otp|cookie\w*|secret\w*|credential\w*|api kalit\w*|service role key|signing key|env)\b',q):return 'deny-secrets'
    if re.search(r'\b(?:boshqa\w*|sinfdosh\w*|falon\w*|biriktirilmagan|adminman)\b',q) and re.search(r'\b(?:bahos\w*|baho\w*|natija\w*|band\w*|audio\w*|telefon\w*|email\w*|chat\w*|yozishma\w*)\b',q):return 'deny-private'
    if re.search(r'\b(?:kalit\w*|javob\w*|variant\w*)\b',q) and re.search(r'\b(?:faol|yopiq|taymer\w*|imtihon\w*|mock\w*)\b',q):return 'deny-unreleased'
    if re.search(r'\b(?:rol\w*|login|authentication|ruxsat\w*)\b',q) and re.search(r'\b(?:chetlab|tekshirma\w*|bekor|ochir\w*|owner qil|admin qil)\b',q):return 'deny-role'
    return None


def guard_reply(message,locale):
    profile=guard_profile(message)
    return library()['responses'][profile][locale] if profile else None


async def answer_question(conn,actor,message,locale,conversation_id=None):
    entry=match_question(message)
    from .riwi_curriculum import is_followup
    if conversation_id and conn is not None and hasattr(conn,'fetchrow') and is_followup(message) and (not entry or entry.get('responseId')=='question-style'):
        from .riwi_material_search import previous_context
        previous=await previous_context(conn,actor,conversation_id)
        model=previous.get('model','')
        if isinstance(model,str) and model.startswith(('riwi-curriculum-v1:','riwi-study-v1:','riwi-reference-v1:','riwi-material-v1')):
            return None # let the original tutor recheck its active source
        profile=previous.get('responseId') if model=='riwi-questions-v1' else None
        response=response_for(profile)
        if response.get('kind')=='answer':
            body=response[locale]
            summary=body.split('🧩',1)[0].strip()
            examples='\n\n🧩'+body.split('🧩',1)[1] if '🧩' in body else ''
            prefix='Asosiy fikrga qaytamiz 🙂\n\n' if locale=='uz' else 'Let’s return to the key point 🙂\n\n'
            practice='\n\nEndi bitta o‘z misolingizni yozing; qaysi qismi qiyinligini birga tekshiramiz.' if locale=='uz' else '\n\nTry one example of your own and tell me which part is difficult.'
            return {'answer':prefix+summary+examples+practice,'provenance':'deterministic_learning_data','citations':[],
                    'provider':{'id':'riwi','model':'riwi-questions-v1','responseId':profile}}
    if not entry:return None
    if entry.get('lessonId'):
        from .riwi_curriculum import retrieve_lesson,format_lesson,MODEL_PREFIX
        lesson=await retrieve_lesson(conn,actor,message,conversation_id,topic_key=entry['lessonId'])
        if not lesson:
            return {'answer':('Bu mavzuning darsi hozirgi bilim bazasida faolligi tasdiqlanmadi. Boshqa ochiq mavzuni yoki qisqa gapingizni yozing.' if locale=='uz' else
                              'I could not verify that this topic lesson is active in the current library. Share another available topic or a short sentence.'),
                    'provenance':'unavailable','citations':[],'provider':{'id':'riwi','model':'riwi-questions-v1'}}
        return {'answer':format_lesson(lesson,message,locale),'provenance':'approved_knowledge',
                'citations':[{k:lesson[k] for k in ('ref','sourceId','unitId','title','authority','version')}],
                'provider':{'id':'riwi','model':MODEL_PREFIX+entry['lessonId'],'lessonVariant':lesson.get('lessonVariant',0),'queryAliases':lesson.get('queryAliases',[])}}
    response=response_for(entry['responseId'])
    return {'answer':response[locale],
            'provenance':'policy_refusal' if response['kind']=='deny' else 'unavailable' if response['kind'] in ('conditional','clarify') else 'deterministic_learning_data',
            'citations':[],'provider':{'id':'riwi','model':'riwi-questions-v1','questionId':entry['id'],'responseId':entry['responseId']}}
