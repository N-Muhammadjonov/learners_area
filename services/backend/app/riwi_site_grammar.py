"""Teaching-only index over every shipped grammar book, without exercise keys."""
from functools import lru_cache
import json
from pathlib import Path
import re
from .riwi_capabilities import authorize_capability
from .riwi_uzbek import normalize_query


@lru_cache(maxsize=1)
def pack():
    data = json.loads((Path(__file__).resolve().parents[1] / 'contracts/riwi_site_grammar_v1.json').read_text())
    if data.get('version') != 'riwi-site-grammar-v1' or len(data.get('entries', [])) != 277:
        raise ValueError('invalid_site_grammar')
    return data


@lru_cache(maxsize=1)
def indexes():
    entries = pack()['entries']
    return {e['id']: e for e in entries}, [(e, [normalize_query(e['title']), normalize_query(e['pattern'])]) for e in entries]


def select(message):
    by_id, aliases = indexes()
    ids = re.findall(r'\b(?:[abc][012]-\d+|spk-\d+|wr-\d+)\b', message.lower())
    known = {value for value in ids if value in by_id}
    if len(known) == 1:
        return by_id[next(iter(known))]
    if len(known) > 1:
        return None
    query = normalize_query(message)
    matches = []
    for entry, values in aliases:
        for value in values:
            if len(value) >= 6 and (' ' + value + ' ') in (' ' + query + ' '):
                matches.append((len(value), entry))
    matches.sort(key=lambda x: x[0], reverse=True)
    if matches and (len(matches) == 1 or matches[0][0] > matches[1][0] or matches[0][1]['id'] == matches[1][1]['id']):
        return matches[0][1]
    return None


KINDS = {
    'mcq': ('Savol shartini o‘qing, variantlarni qoida bilan solishtiring va talab qilingan sonini tanlang.', 'Read the instruction, compare choices against the rule, and select the required number.'),
    'judge': ('Gapni qoida bilan tekshirib, to‘g‘ri yoki xatoligini belgilang; taxmin emas, sabab toping.', 'Check the sentence against the rule and decide whether it is correct; identify a reason.'),
    'match': ('Chap va o‘ngdagi mazmunan mos bo‘laklarni juftlang; faqat bir xil so‘zga tayanmang.', 'Pair corresponding meanings; do not rely only on identical words.'),
    'order': ('So‘zlarni ega, fe’l va qolgan bo‘laklar tartibiga keltiring; savol/inkorni tekshiring.', 'Order the words using the sentence pattern; check questions and negatives.'),
    'fix': ('Xato bo‘lakni aniqlang va qoida asosida tuzating; ma’noni saqlang.', 'Locate and correct the error using the rule while preserving meaning.'),
    'transform': ('Berilgan shart bilan shaklni o‘zgartiring, asl ma’noni saqlang.', 'Transform the form as instructed while retaining the original meaning.'),
    'tr': ('O‘zbekcha fikrni inglizcha qolipda mustaqil ifodalang; so‘zma-so‘z almashtirmang.', 'Express the Uzbek meaning in the English pattern; avoid word-for-word substitution.'),
    'translate': ('Fikrni inglizcha qolipda mustaqil ifodalang; ma’no va grammatikani tekshiring.', 'Express the meaning using the English pattern and check grammar.'),
    'speak': ('Qolip bilan o‘z javobingizni ayting, so‘ng qayta tinglab aniqligini tekshiring.', 'Say your own answer using the pattern, then listen back to check clarity.'),
    'record': ('O‘z javobingizni gapirib yozing va modulning ko‘rsatmasiga amal qiling.', 'Record your own response and follow the module instructions.'),
    'write': ('Mavzuga mos o‘z matningizni yozing, talab qilingan tuzilma va hajmni tekshiring.', 'Write your own relevant text and check the requested structure and length.'),
    'longtext': ('Mustaqil matn yozing; mavzu, tuzilma va hajmni yo‘riqnoma bilan tekshiring.', 'Write independently and check the topic, structure and length against the instructions.'),
}


def instructions(entry, locale):
    uz = locale == 'uz'
    lines = ['🛠 Mashqni bajarish tartibi:' if uz else '🛠 How to work through the exercise:']
    for i, stage in enumerate(entry['stages'], 1):
        details = []
        for kind in dict.fromkeys(stage['kinds']):
            instruction = KINDS.get(kind, ('Qolipni kerakli bo‘sh joyga qo‘llang va o‘z javobingizni tekshiring.', 'Apply the pattern to the prompt and check your own response.'))
            details.append(instruction[0 if uz else 1])
        lines.append(str(i) + ') ' + (' '.join(details)))
    return '\n\n'.join(lines)


def reply(actor, message, locale):
    if not authorize_capability(actor, 'riwi.grammar.explain').allowed:
        return None
    entry = select(message)
    if not entry:
        return None
    uz = locale == 'uz'
    lines = [('Qoidani uchta namuna bilan ko‘ramiz 🙂' if uz else 'Let’s compare the pattern with three examples 🙂'),
        entry['title'], ('Tuzilma: ' if uz else 'Pattern: ') + entry['pattern']]
    if uz:
        lines.extend(entry['pointsUz'][:4])
        if entry['table']:
            lines.append('\n'.join(' · '.join(str(v) for v in row) for row in entry['table'][:8]))
    else:
        lines.append('Use the pattern as a complete sentence, replacing its variable parts with your intended meaning. Compare the subject, verb form and following phrase in each example. The examples illustrate the rule; they are not answers to your exercise.')
    lines.append('🧩 3 ta namuna:' if uz else '🧩 Three examples:')
    lines.extend(f'{i}) {x["en"]}' + ('\n— ' + x['uz'] if uz else '') for i, x in enumerate(entry['examples'][:3], 1))
    lines.append(instructions(entry, locale))
    lines.append('Mashqning tayyor javobini bermayman. O‘zingiz urinib ko‘ring; qaysi qadam qiyinligini aytsangiz usulini tushuntiraman.' if uz else
        'I explain the method rather than give the exercise key. Try it yourself and tell me which step is difficult.')
    answer = '\n\n'.join(lines).replace('**', '').replace('`', '')
    return {'answer': answer[:5800], 'provenance': 'canonical_grammar', 'citations': [],
        'provider': {'id': 'riwi', 'model': 'riwi-site-grammar-v1', 'grammarUnitId': entry['id']}}
