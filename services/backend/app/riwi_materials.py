"""Current published study material, read in place with source and exam guards.

Private submissions, personal pattern banks and learner recordings are never a
shared corpus. Objective answer explanations keep their separate attempt gate.
No URL fetching, provider calls, inferred answer keys or model training.
"""
from __future__ import annotations

import hashlib
from html.parser import HTMLParser
import json
import re

from .riwi_capabilities import authorize_capability
from .riwi_contracts import UUID_RE

KINDS = ('reading', 'listening', 'writing', 'language-stealing', 'speaking', 'podcast', 'retention')
CAPABILITIES = {'reading': 'riwi.reading.explain', 'listening': 'riwi.listening.explain',
                'retention': 'riwi.reading.explain'}
MAX_TEXT = 40000


def validate_reference(raw):
    if not isinstance(raw, dict) or set(raw) != {'kind', 'id'}:
        raise ValueError('invalid_material_reference')
    if raw.get('kind') not in KINDS or not isinstance(raw.get('id'), str) or not UUID_RE.fullmatch(raw['id']):
        raise ValueError('invalid_material_reference')
    return {'kind': raw['kind'], 'id': raw['id'].lower()}


async def gate(conn, actor, kind):
    if kind not in KINDS:
        raise ValueError('invalid_material_kind')
    if not authorize_capability(actor, CAPABILITIES.get(kind, 'riwi.knowledge.read_approved')).allowed:
        raise PermissionError('forbidden')
    if actor.role == 'student' and await conn.fetchval('''SELECT
      EXISTS(SELECT 1 FROM reading_attempts WHERE user_id=$1::uuid AND status='in_progress') OR
      EXISTS(SELECT 1 FROM listening_attempts WHERE user_id=$1::uuid AND status='in_progress') OR
      EXISTS(SELECT 1 FROM retention_attempts WHERE user_id=$1::uuid AND status IN ('reading','recall'))''', actor.id):
        raise PermissionError('active_exam_lookup_forbidden')


# Closed, server-owned SQL fragments; no browser field selects a table/column.
def selection(kind):
    if kind == 'reading':
        return """SELECT p.id,p.title,p.body_text AS text,p.source_ref AS attribution
          FROM reading_passages p WHERE p.publication_state='published' AND p.is_active
          AND EXISTS(SELECT 1 FROM general_reading_passages g JOIN general_reading_sets s ON s.id=g.set_id
            WHERE g.passage_id=p.id AND s.publication_state='published'
            AND NOT EXISTS(SELECT 1 FROM activity_events d WHERE d.id=md5('deleted-content:'||s.id::text)::uuid AND d.type='CONTENT_DELETED'))"""
    if kind == 'listening':
        return """SELECT t.id,t.title,coalesce(CASE WHEN t.transcript ~ '[^[:space:]]' THEN t.transcript END,
          (SELECT string_agg(section->>'transcript',E'\\n') FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(p.payload->'sections')='array' THEN p.payload->'sections' ELSE '[]'::jsonb END) section
            WHERE jsonb_typeof(section->'transcript')='string'),'') AS text,t.source_ref AS attribution
          FROM listening_tests t LEFT JOIN listening_packages p ON p.test_id=t.id
          WHERE t.publication_state='published' AND t.is_active
          AND ($2::text IN ('owner','teacher') OR EXISTS(
            SELECT 1 FROM listening_attempts a WHERE a.test_id=t.id AND a.user_id=$1::uuid
              AND a.status='completed' AND a.content_version_id IS NOT NULL
              AND a.content_version_id=(SELECT v.id FROM content_versions v
                WHERE v.module='listening' AND v.target_type='listening_test' AND v.target_id=t.id
                  AND v.status='published' ORDER BY v.version_no DESC LIMIT 1)))
          AND NOT EXISTS(SELECT 1 FROM activity_events d WHERE d.id=md5('deleted-content:'||t.id::text)::uuid AND d.type='CONTENT_DELETED')"""
    if kind == 'writing':
        return """SELECT id,title,body AS text,provenance AS attribution FROM writing_model_texts
          WHERE publication_state='published'"""
    if kind == 'language-stealing':
        return """SELECT id,pattern AS title,concat_ws(E'\\n',example,usage_note) AS text,provenance AS attribution
          FROM writing_language_patterns WHERE publication_state='published'"""
    if kind == 'speaking':
        return """SELECT id,coalesce(nullif(topic,''),'Speaking')||': '||left(prompt_text,100) AS title,
          concat_ws(E'\\n',prompt_text,study_support->>'modelAnswerHtml',study_support->>'ideasHtml') AS text,
          source_class AS attribution FROM speaking_prompts
          WHERE publication_state='published' AND is_active AND available_in @> '["practice_alone"]'::jsonb"""
    if kind == 'podcast':
        return """SELECT v.id,v.title,coalesce(CASE WHEN v.transcript_text ~ '[^[:space:]]' THEN v.transcript_text END,
          (SELECT string_agg(segment->>'text',E'\\n') FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(v.transcript)='array' THEN v.transcript ELSE '[]'::jsonb END) segment),'') AS text,
          v.transcript_attribution AS attribution FROM video_lessons v
          WHERE v.publication_state='published' AND v.is_active
          AND (v.lesson_id IS NULL OR EXISTS(SELECT 1 FROM lessons l JOIN units u ON u.id=l.unit_id
            JOIN course_modules m ON m.id=u.module_id WHERE l.id=v.lesson_id AND l.publication_state='published'
            AND ($2::text='owner' OR EXISTS(SELECT 1 FROM enrollments e WHERE e.course_id=m.course_id AND e.user_id=$1::uuid))))"""
    if kind == 'retention':
        # Each learner sees only the version they have already finished. The
        # active memory-test bank and its scoring claims remain hidden.
        return """SELECT v.id,t.level::text||' · '||t.internal_label AS title,v.body_text AS text,
          'Retention version '||v.version_number::text AS attribution
          FROM retention_text_versions v JOIN retention_texts t ON t.id=v.retention_text_id
          WHERE ($2::text='owner' AND t.active AND t.current_version_id=v.id) OR
          EXISTS(SELECT 1 FROM retention_attempts a WHERE a.retention_text_version_id=v.id
            AND a.user_id=$1::uuid AND a.status IN ('completed','timed_out'))"""
    raise ValueError('invalid_material_kind')


def _base(kind):
    # Always bind the actor, including for kinds whose public predicate does
    # not need it. This keeps a single parameter contract for all selectors.
    return 'WITH actor AS (SELECT $1::uuid uid,$2::text role), material AS (' + selection(kind) + ') '


async def list_materials(conn, actor, kind, query=''):
    await gate(conn, actor, kind)
    if not isinstance(query, str) or len(query) > 160:
        raise ValueError('invalid_material_query')
    query = query.strip()
    rows = await conn.fetch(_base(kind) + '''SELECT id::text,title FROM material
      WHERE coalesce(text,'') ~ '[^[:space:]]' AND ($3::text='' OR strpos(lower(title),lower($3))>0)
      ORDER BY title,id LIMIT 31''', actor.id, actor.role, query)
    return {'items': [{'id': str(r['id']), 'kind': kind, 'title': str(r['title'])[:240]} for r in rows[:30]],
            'hasMore': len(rows) > 30}


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.ignored = 0
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'): self.ignored += 1
        if tag in ('p', 'br', 'li', 'div'): self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in ('script', 'style') and self.ignored: self.ignored -= 1
        if tag in ('p', 'li', 'div'): self.parts.append('\n')
    def handle_data(self, data):
        if not self.ignored: self.parts.append(data)


def plain(text):
    parser = PlainText()
    parser.feed(str(text or '')[:MAX_TEXT])
    return re.sub(r'[ \t]+', ' ', ''.join(parser.parts)).strip()


def transcript_text(value):
    """Only text segments; never serialize a payload containing answer keys."""
    if isinstance(value, str): return value
    if isinstance(value, list):
        return '\n'.join(str(s.get('text') or '') for s in value[:2500] if isinstance(s, dict))
    return ''


async def read_material(conn, actor, reference):
    ref = validate_reference(reference)
    kind = ref['kind']
    await gate(conn, actor, kind)
    row = await conn.fetchrow(_base(kind) + '''SELECT id::text,title,left(text,40000) AS text,attribution
      FROM material WHERE id=$3::uuid''', actor.id, actor.role, ref['id'])
    if not row: raise LookupError('not_found')
    item = dict(row)
    if kind == 'listening':
        from .browser_listening import content
        from .browser_common import identifier
        # Reuse the existing product/sequence availability check.
        current, payload = await content(conn, {'id': actor.id, 'role': actor.role}, identifier(ref['id']))
        primary=str(current.get('transcript') or '')
        parts = [primary] if primary.strip() else [transcript_text(s.get('transcript')) for s in payload.get('sections', []) if isinstance(s, dict)]
        if not any(p.strip() for p in parts):
            study = payload.get('studyPack') or {}
            parts += [transcript_text(s.get('transcript')) for s in study.get('scriptParts', []) if isinstance(s, dict)]
        item['text'] = '\n'.join(p for p in parts if p.strip())[:MAX_TEXT]
    if kind == 'podcast' and str(item['text']).lstrip().startswith('['):
        try: item['text'] = transcript_text(json.loads(item['text']))
        except ValueError: item['text'] = ''
    if kind == 'speaking':
        support=await conn.fetchval('''SELECT study_support FROM speaking_prompts WHERE id=$1::uuid
          AND publication_state='published' AND is_active AND available_in @> '["practice_alone"]'::jsonb''',ref['id'])
        if isinstance(support,str):
            try:support=json.loads(support)
            except ValueError:support={}
        vocabulary=support.get('vocabulary',[]) if isinstance(support,dict) else []
        item['vocabulary']=[{k:str(v.get(k) or '')[:700] for k in
                            ('term','definitionEn','translationUz','exampleSentence')}
                            for v in vocabulary[:40] if isinstance(v,dict)] if isinstance(vocabulary,list) else []
    item['text'] = plain(item['text'])
    if not item['text']: raise LookupError('material_text_unavailable')
    item['kind'] = kind
    item['contentHash'] = hashlib.sha256(item['text'].encode()).hexdigest()
    return item


STOP_WORDS = frozenset('a an the in on at to for and or but of is are was were it this that these those i you he she we they have has had will would can could should nima qanday menga bilan uchun haqida shu shuyning buni tushuntir izohla misol misollar ber reading listening writing speaking podcast retention material'.split())


def sentences(text):
    return [s.strip() for s in re.split(r'(?<=[.!?])\s+|\n+', text) if 25 <= len(s.strip()) <= 550]


def select_evidence(text, message):
    # Lexical evidence selection is deliberately labelled as an excerpt, not
    # as an inferred answer or generated summary of an unseen source.
    terms = {w.lower() for w in re.findall(r"[A-Za-z]+(?:'[a-z]+)?", message) if len(w) > 2} - STOP_WORDS
    choices = sentences(text)
    scored = [(len(terms & set(re.findall(r'[a-z]+', s.lower()))), i, s) for i, s in enumerate(choices)]
    matches = sorted(scored, key=lambda x: (-x[0], x[1]))
    selected = sorted(matches[:3], key=lambda x: x[1]) if any(x[0] for x in matches) else scored[:3]
    return [s for _, _, s in selected]


def teach_material(item, message, locale, *, supplement=None):
    uz = locale == 'uz'
    evidence = select_evidence(item['text'], message)
    lines = [('Keling, shu material bilan ishlaymiz 🙂' if uz else 'Let’s work with this material 🙂'),
             '📘 '+('Matn bilan mashq' if uz else 'Text practice')]
    if item['kind'] == 'speaking':
        lines.append(('Bu — mashq savoli va mavjud bo‘lsa, namuna javob. Namunadagi hayotiy voqeani o‘zingizniki deb yodlamang: uning tuzilishidan foydalaning. Matndan talaffuz yoki band ballini aniqlab bo‘lmaydi.' if uz else
                      'This is a practice prompt with a model answer when available. Learn from its structure and use your own experience. Text alone does not establish pronunciation or an IELTS band.'))
    if evidence:
        lines.append(('🔎 Tahlil qilinadigan gaplar:' if uz else '🔎 Sentences to study:')+'\n'+
                     '\n'.join(f'{i+1}) “{s}”' for i, s in enumerate(evidence)))
    from .riwi_uzbek import normalize_query
    query=' '+normalize_query(message)+' '
    words=[v for v in item.get('vocabulary',[]) if v['term'] and
           ' '+normalize_query(v['term'])+' ' in query]
    for word in words[:3]:
        meaning=word['translationUz'] if uz else word['definitionEn']
        if meaning and meaning.lower()!=word['term'].lower():
            lines.append('📖 '+word['term']+' — '+meaning+
                         ('\n'+word['exampleSentence'] if word['exampleSentence'] else ''))
    if supplement:
        lines.append(supplement)
        return '\n\n'.join(lines)
    if item['kind'] in ('writing','language-stealing'):
        explanation = ('Avval gap qanday vazifa bajarayotganini belgilang: fikr bildirish, sabab, misol yoki qarama-qarshilik. So‘ng qolipdagi o‘zgaruvchan qismlarni almashtiring. Ma’nosini bilmay turib uzun iborani yodlamang; yangi gapingiz asl qolipning vazifasini saqlasin.' if uz else
                       'Identify the function first: an opinion, reason, example or contrast. Replace the variable parts while keeping the function. Check the meaning and grammar of your new sentence before using it in your own writing.')
    elif item['kind'] == 'retention':
        explanation = ('Bu siz tugatgan matn nusxasi yoki Owner ko‘rishi mumkin bo‘lgan material. Paragrafni o‘qing, keyin yopib uch narsani eslang: asosiy fikr, sabab va bitta tafsilot. Javobingizni aynan shu nusxa bilan solishtiring. Biror detal esingizga kelmasa, uni taxmin bilan to‘ldirmang.' if uz else
                       'Read one paragraph, hide it, and recall its main idea, a reason and one detail. Compare your recall with this exact version. Leave an uncertain detail blank rather than inventing it.')
    else:
        explanation = ('Avval kim yoki nima haqida gap ketayotganini toping. Keyin fe’l orqali nima sodir bo‘lganini aniqlang. Because, but, however kabi bog‘lovchilar fikrlar orasidagi aloqani ko‘rsatadi. Javobingizga manbadagi dalilni bog‘lang; matnda yo‘q ma’lumotni qo‘shmang.' if uz else
                       'Find who or what the sentence is about, then use the verb to identify the event or claim. Linking words such as because, but and however show how ideas connect. Support your answer with the source and keep unstated details separate.')
    lines.append(explanation)
    if item['kind'] == 'speaking':
        examples = [('I enjoy it because it helps me relax.','Bu menga yoqadi, chunki dam olishimga yordam beradi.'),
                    ('For example, I tried it with a friend last weekend.','Masalan, o‘tgan dam olish kunida buni do‘stim bilan sinab ko‘rdim.'),
                    ('If I had more time, I would do it more often.','Vaqtim ko‘proq bo‘lganida, buni tez-tez qilgan bo‘lardim.')]
    else:
        examples = [('The writer gives a reason for the change.','Muallif o‘zgarishning sababini keltiradi.'),
                    ('This example supports the main point.','Bu misol asosiy fikrni dalillaydi.'),
                    ('The passage does not state when it happened.','Matnda bu qachon sodir bo‘lgani aytilmagan.')]
    lines.append(('🧩 3 ta misol:' if uz else '🧩 Three example sentences:')+'\n'+
                 '\n'.join(f'{i+1}) {en}'+('\n   — '+tr if uz else '') for i,(en,tr) in enumerate(examples)))
    lines.append(('✍️ Mashq: tanlangan parchadan bitta fikrni o‘z so‘zingiz bilan ayting va uni qaysi jumla tasdiqlashini ko‘rsating.' if uz else
                  '✍️ Practice: restate one source point in your own words and identify the sentence that supports it.'))
    return '\n\n'.join(lines)
