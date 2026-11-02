"""Bounded, explainable grammar help. No general semantic or examiner claim."""
import re
from .riwi_uzbek import normalize_query

_BASE={'goes':'go','went':'go','studies':'study','studied':'study','works':'work','worked':'work',
       'plays':'play','played':'play','eats':'eat','ate':'eat','comes':'come','came':'come',
       'takes':'take','took':'take','writes':'write','wrote':'write','finishes':'finish','finished':'finish'}
_PRESENT={k:v for k,v in _BASE.items() if k in {'goes','studies','works','plays','eats','comes','takes','writes','finishes'}}
_PAST={k:v for k,v in _BASE.items() if k not in _PRESENT}

def correction_request(message):
    if not isinstance(message,str):return None
    parts=re.split(r'[:：]\s*',message,1)
    if len(parts)!=2:return None
    head,text=parts[0],parts[1].strip().strip('“”"')
    query=normalize_query(head)
    english=re.fullmatch(r'(?:please )?(?:correct (?:this grammar|this sentence|my sentence)|check (?:this grammar|this sentence)|grammar check)',query)
    uzbek=any(w.startswith(('tuzat','tekshir')) for w in query.split()) and any(w in query.split() for w in ('gap','gapni','grammatika','grammatik'))
    if not (english or uzbek) or not 1<=len(text)<=1200:return None
    corrected=text;reasons=[];topic='grammar.error_correction'
    def apply(pattern,forms,key,uz,en):
        nonlocal corrected,topic
        def replace(match):
            nonlocal topic
            word=match.group('verb');base=forms.get(word.lower())
            if base is None:return match.group(0)
            if word.isupper():base=base.upper()
            reasons.append({'uz':uz,'en':en});topic=key
            return match.group('prefix')+base
        corrected=re.sub(pattern,replace,corrected,flags=re.I)
    # A closed set of known inflections avoids false corrections such as
    # "does not pass" and avoids the ambiguity of saw (see vs cut wood).
    verbs='|'.join(map(re.escape,_PRESENT))
    apply(r"\b(?P<prefix>(?:does not|doesn't|do not|don't)\s+)(?P<verb>"+verbs+r')\b',_PRESENT,'grammar.present-simple',
          'Do/does bilan inkorda asosiy fe’l oddiy shaklda keladi; unga yana -s qo‘shilmaydi.',
          'After do/does in a negative, use the base verb without an extra -s.')
    apply(r'\b(?P<prefix>does\s+(?:he|she|it)\s+)(?P<verb>'+verbs+r')\b',_PRESENT,'grammar.present-simple',
          'Does bilan savolda asosiy fe’l oddiy shaklda keladi.',
          'After does in this question, use the base verb.')
    verbs='|'.join(map(re.escape,_PAST))
    apply(r"\b(?P<prefix>(?:did not|didn't|did\s+(?:I|you|we|they|he|she|it))\s+)(?P<verb>"+verbs+r')\b',_PAST,'grammar.past-simple',
          'Did o‘tgan zamonni ko‘rsatib turibdi; undan keyingi asosiy fe’l oddiy shaklda bo‘ladi.',
          'Did already marks the past; the main verb must use its base form.')
    for wrong,right in (('a hour','an hour'),('an university','a university'),('an user','a user')):
        pattern=r'\b'+re.escape(wrong)+r'\b'
        if re.search(pattern,corrected,re.I):
            def article(m):return right.capitalize() if m.group(0)[0].isupper() else right
            corrected=re.sub(pattern,article,corrected,flags=re.I);topic='grammar.articles'
            reasons.append({'uz':'A/an tanlovi birinchi harfga emas, birinchi talaffuz tovushiga bog‘liq.',
                            'en':'Choose a/an by the initial sound, not the written letter.'})
    if not reasons:
        query_text=normalize_query(text)
        if re.search(r'\b(went|worked|studied|played|finished|visited|bought)\b',query_text) and re.search(r'\b(yesterday|last|ago)\b',query_text):
            topic='grammar.past-simple'
        elif re.search(r'\b(have|has)\b',query_text):topic='grammar.present-perfect'
        elif re.search(r'\b(does|every)\b',query_text):topic='grammar.present-simple'
    return {'original':text,'corrected':corrected,'reasons':reasons,'topic':topic}

def format_correction(check,lesson,locale):
    uz=locale=='uz'
    lines=['Gapingizni alohida ko‘rib chiqamiz 🙂' if uz else 'Let’s look at your sentence 🙂',
           ('Siz yozgansiz:\n' if uz else 'You wrote:\n')+check['original']]
    if check['reasons']:
        lines.append(('Tavsiya qiladigan tuzatishim:\n' if uz else 'Suggested correction:\n')+check['corrected'])
        reasons=list(dict.fromkeys(r['uz' if uz else 'en'] for r in check['reasons']))
        lines.append(('Nega?\n' if uz else 'Why?\n')+'\n'.join('• '+r for r in reasons))
    else:
        lines.append('Ichki qoidalarim bu gapda aniq tuzatish talab qiladigan xatoni ko‘rsatmadi. Shuning uchun uni boshqa gapga almashtirmayman. Bu barcha ma’no va uslub jihatlari to‘liq tekshirildi degani emas.' if uz else
                     'My supported rules did not identify a definite correction, so I will preserve your wording. This does not certify every aspect of meaning or style.')
    lines.append(('Quyidagi qoida va uchta misol bilan solishtiring 👇' if uz else 'Compare it with the rule and three examples below 👇'))
    lines.append(lesson)
    result='\n\n'.join(lines)
    if len(result)>5500:raise ValueError('correction_answer_too_large')
    return result

def smalltalk(message,locale):
    query=normalize_query(message)
    uz=locale=='uz'
    if query in ('salom','assalomu alaykum','assalom','hello','hi','hey'):
        return ('Salom! 🙂 Ingliz tilini birga o‘rganamiz. Qaysi joyi qiyin bo‘lyapti?\n\nMasalan:\n• «Present perfect ni sodda tushuntir.»\n• «TRUE/FALSE/NOT GIVEN farqi nima?»\n• «Collocation uchun misollar ber.»' if uz else
                'Hi! 🙂 What would you like to work on?\n\nYou can ask for a simple grammar explanation, IELTS reading guidance, or vocabulary examples.')
    if query in ('rahmat','katta rahmat','raxmat','rahmat sizga','thanks','thank you'):
        return 'Arzimaydi 🙂 Tayyor bo‘lsangiz, bitta yangi gap yozib mashq qilib ko‘ramiz!' if uz else 'You’re welcome 🙂 Try a new sentence when you’re ready!'
    return None
