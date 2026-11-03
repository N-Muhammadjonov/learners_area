"""Explain explicit learner sentences with closed grammar rules and approved words.

An unsupported sentence is preserved, never disguised as a fluent translation.
This is a bounded parser, not a general language model.
"""
import re
from .riwi_uzbek import normalize_query


def text_request(message):
    match=re.fullmatch(r'(.{1,110}?)[:：]\s*(.{1,1200})',message.strip(),re.S)
    if not match:
        quoted=re.search(r'[“"]([^”"]{3,1200})[”"]',message)
        if quoted and len(quoted[1].split())>=3 and re.search(r'\b(tarjima\w*|translate|tahlil\w*|explain)\b',normalize_query(message[:quoted.start()]+message[quoted.end():])):
            return quoted[1],normalize_query(message[:quoted.start()]+message[quoted.end():])
        return None
    head,value=match.groups();q=normalize_query(head)
    if not re.search(r'\b(tarjima\w*|translate|translation|tahlil\w*|analyse|analyze|explain this sentence|gapni tushuntir)\b',q):return None
    return value.strip().strip('“”"'),q


# Original, finite teaching vocabulary. Inflection and complements must both match.
VERBS={
 'go':('goes','went','gone','going','bor'),
 'work':('works','worked','worked','working','ishla'),
 'study':('studies','studied','studied','studying','o‘qi'),
 'read':('reads','read','read','reading','o‘qi'),
 'write':('writes','wrote','written','writing','yoz'),
 'eat':('eats','ate','eaten','eating','ye'),
 'play':('plays','played','played','playing','o‘yna'),
 'finish':('finishes','finished','finished','finishing','tugat'),
}
COMPLEMENTS={
 'go':{'to school':'maktabga','home':'uyga','to work':'ishga','to the park':'bog‘ga'},
 'work':{'':'','at school':'maktabda','at home':'uyda'},
 'study':{'english':'ingliz tilini','at school':'maktabda'},
 'read':{'a book':'kitob','the book':'kitobni','books':'kitoblar'},
 'write':{'a letter':'xat','the letter':'xatni','an essay':'insho'},
 'eat':{'an apple':'olma','breakfast':'nonushta','lunch':'tushlik'},
 'play':{'football':'futbol','tennis':'tennis'},
 'finish':{'my homework':'uy vazifamni','the task':'vazifani'},
}
SUBJECTS={'i':('Men','man','m'),'you':('Siz','siz','ngiz'),'he':('U','',''),
          'she':('U','',''),'we':('Biz','miz','k'),'they':('Ular','','lar')}
TIMES={'every day':'har kuni','yesterday':'kecha','now':'hozir','already':'allaqachon'}
EXACT_UZ={
 'men har kuni maktabga boraman':'I go to school every day.',
 'u hozir kitob oqiyapti':'He or she is reading a book now.',
 'men kecha xat yozdim':'I wrote a letter yesterday.',
}


def analyse_sentence(value):
    q=value.strip().rstrip('.!?').lower().replace('’',"'")
    if normalize_query(value) in EXACT_UZ:
        topic='grammar.past-simple' if 'kecha' in normalize_query(value) else 'grammar.present-continuous' if 'hozir' in normalize_query(value) else 'grammar.present-simple'
        return {'translation':EXACT_UZ[normalize_query(value)],'topic':topic,
                'noteUz':'O‘zbekchada fe’l ko‘pincha oxirida keladi. Inglizcha darak gapda ega + fe’l + to‘ldiruvchi tartibini tekshiring.',
                'noteEn':'Uzbek often places the verb last. In an English statement, check subject + verb + object order.'}
    m=re.fullmatch(r'(i|you|he|she|we|they) (.+)',q)
    if not m:return None
    subject,rest=m.groups();time=''
    for marker in TIMES:
        if rest.endswith(' '+marker):rest=rest[:-len(marker)-1];time=marker;break
    person,ending,pastending=SUBJECTS[subject]
    for base,(third,past,participle,ing,uz) in VERBS.items():
        patterns=[('grammar.present-simple',third if subject in ('he','she') else base,'present'),
                  ('grammar.past-simple',past,'past'),
                  ('grammar.present-perfect',('has' if subject in ('he','she') else 'have')+' '+participle,'perfect'),
                  ('grammar.present-continuous',('am' if subject=='i' else 'is' if subject in ('he','she') else 'are')+' '+ing,'continuous')]
        for topic,form,tense in patterns:
            if not (rest==form or rest.startswith(form+' ')):continue
            tail=rest[len(form):].strip()
            if tail not in COMPLEMENTS[base]:continue
            # "read" is ambiguous without an explicit past-time marker.
            if base=='read' and subject not in ('he','she') and tense in ('past','present') and not time:return None
            if tense=='perfect' and time=='yesterday' or tense=='present' and time=='yesterday':return None
            if tense=='past' and time=='every day':return None
            if tense=='continuous':verb=uz+'yap'+(ending or 'ti')
            elif tense=='past':verb=uz+'di'+pastending
            elif tense=='perfect':verb=uz+'gan'+ending
            else:verb=uz+('y' if uz.endswith(('a','i','e')) else 'a')+('di' if not ending else ending)
            translation=' '.join(x for x in (person,TIMES.get(time,''),COMPLEMENTS[base][tail],verb) if x)+'.'
            notes={
             'present':('Bu gap odat yoki takrorlanadigan ishni bildiradi. He/she bilan fe’lga -s/-es qo‘shiladi.', 'This describes a habit or repeated action. He/she takes the -s/-es form.'),
             'past':('Ish o‘tgan zamonda sodir bo‘lgan. Fe’lning o‘tgan zamon shakli ishlatilgan.', 'The action happened in the past. The verb uses its past form.'),
             'perfect':('Have/has + V3: oldin bajarilgan ishning hozir bilan aloqasi bor. Aniq ma’no kengroq kontekstga ham bog‘liq.', 'Have/has + past participle links an earlier action to the present. Wider context determines the exact meaning.'),
             'continuous':('Am/is/are + V-ing: ish hozir yoki vaqtinchalik davom etyapti.', 'Am/is/are + V-ing describes an ongoing or temporary action.')}
            return {'translation':translation,'topic':topic,'noteUz':notes[tense][0],'noteEn':notes[tense][1]}
    return None


async def explain_request(conn,actor,message,locale,broker):
    request=text_request(message)
    if not request:return None
    value,head=request;uz=locale=='uz'
    from .riwi_materials import gate
    if conn is not None and hasattr(conn,'fetchval'):
        try:await gate(conn,actor,'reading')
        except PermissionError:
            from .riwi_material_search import clarification
            return {'answer':clarification('active_exam_lookup_forbidden',locale),'provenance':'policy_refusal','citations':[]}
    analysis=analyse_sentence(value)
    from .riwi_grammar_reference import translate_example,format_lesson as format_reference
    reference=await translate_example(conn,actor,value)
    lines=[('Gapni birga ko‘rib chiqamiz 🙂\n\n' if uz else 'Let’s look at the sentence 🙂\n\n')+value]
    citations=[]
    if reference:
        lines.append(('Ma’nosi: ' if uz else 'Meaning: ')+reference['translation'])
        lines.append(format_reference(reference['unit'],message,locale))
        citations=[{k:reference['unit'][k] for k in ('ref','sourceId','unitId','title','authority','version')}]
    elif analysis:
        lines.append(('Ma’nosi: ' if uz else 'Meaning: ')+analysis['translation'])
        lines.append(analysis['noteUz' if uz else 'noteEn'])
        from .riwi_curriculum import retrieve_lesson,format_lesson
        lesson=await retrieve_lesson(conn,actor,message,topic_key=analysis['topic'])
        if lesson:
            lines.append(format_lesson(lesson,message,locale))
            citations=[{k:lesson[k] for k in ('ref','sourceId','unitId','title','authority','version')}]
    else:
        lines.append('Bu gapni to‘liq va ishonchli tarjima qilishga qoidalarim yetmayapti. So‘zlarni ketma-ket almashtirish to‘g‘ri tarjima bermaydi.' if uz else
                     'My rules cannot translate this whole sentence reliably. Replacing individual words would not produce a reliable sentence translation.')
        stop={'the','and','for','this','that','with','from','have','has','you','are','was','were','tarjima','qil','men','shu','gapni'}
        words=list(dict.fromkeys(w.lower() for w in re.findall(r'\b[A-Za-z]{3,30}\b',value) if w.lower() not in stop))[:4]
        for word in words:
            out=await broker.execute(conn,actor=actor,tool_name='dictionary.lookup',raw_input={'term':word,'locale':locale})
            if out.get('resolved'):
                lines.append(out['summary'])
        lines.append('Qaysi so‘z yoki gap bo‘lagi qiyinligini ayting; qismlarga ajratib ishlaymiz.' if uz else
                     'Tell me which word or clause is difficult, and we can work through it in parts.')
    return {'answer':'\n\n'.join(lines)[:5800],'provenance':'deterministic_learning_data' if analysis or reference else 'unavailable','citations':citations}
