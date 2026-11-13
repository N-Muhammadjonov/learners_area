"""Compose new examples only for verified verbs and supported inflections."""
import re
from .riwi_capabilities import authorize_capability
from .riwi_uzbek import normalize_query


async def reply(conn, actor, message, locale, broker):
    q = normalize_query(message)
    if not authorize_capability(actor, 'riwi.grammar.explain').allowed or not re.search(r'\b(?:misol|gap|gaps|sentences?|examples?)\b', q):
        return None
    match = re.search(r'[“"\x27]([a-zA-Z]{2,25})[”"\x27]\s*(?:sozi|word)?', message)
    if not match:
        match = re.search(r'\b([a-z]{2,25})\s+(?:sozi bilan|word bilan|word in|bilan)\b', q)
    if not match:
        return None
    term = match[1].lower()
    from .riwi_understanding import VERBS, COMPLEMENTS
    if term not in VERBS:
        return None  # never invent an unknown verb's morphology/complements
    topic = next((t for t in ('present simple', 'past simple', 'present continuous', 'present perfect') if t in q), None)
    if not topic:
        return None
    meaning = VERBS[term][4] + 'moq'
    out = await broker.execute(conn, actor=actor, tool_name='dictionary.lookup', raw_input={
        'term': term, 'locale': locale, 'partOfSpeech': 'verb', 'meaningUz': meaning})
    if not out.get('resolved') or out.get('partOfSpeech', '').lower() not in ('verb', 'v'):
        return {'answer': ('So‘zning fe’l ma’nosi lug‘atda tasdiqlanmadi. Uni noto‘g‘ri shaklda gapga joylamayman; aniq so‘z va ma’noni yozing.' if locale == 'uz' else
            'I could not verify the verb sense in the dictionary. I will not invent its forms; specify the word and intended sense.'),
            'provenance': 'unavailable', 'citations': [], 'provider': {'id': 'riwi', 'model': 'riwi-grammar-examples-v1'}}
    third, past, participle, ing, _ = VERBS[term]
    tail = next(iter(COMPLEMENTS[term]))
    pairs = {'present simple': [('I', term), ('She', third), ('They', term)],
        'past simple': [('I', past), ('She', past), ('They', past)],
        'present continuous': [('I', 'am ' + ing), ('She', 'is ' + ing), ('They', 'are ' + ing)],
        'present perfect': [('I', 'have ' + participle), ('She', 'has ' + participle), ('They', 'have ' + participle)]}
    notes = {'present simple': ('Odat/takrorlanish; she bilan -s/-es.', 'Habit/repetition; she takes -s/-es.'),
        'past simple': ('Tugagan o‘tgan ish; o‘tgan fe’l shakli.', 'A completed past action; use the past form.'),
        'present continuous': ('Davom etayotgan ish; am/is/are + -ing.', 'An ongoing action; am/is/are + -ing.'),
        'present perfect': ('Oldingi ishning hozir bilan aloqasi; have/has + V3.', 'An earlier action linked to now; have/has + past participle.')}
    lines = [out['summary'], topic + ': ' + notes[topic][0 if locale == 'uz' else 1]]
    lines.extend(f'{i}) {subject} {form}' + (' ' + tail if tail else '') + '.' for i, (subject, form) in enumerate(pairs[topic], 1))
    lines.append('Bu yangi namunalar, mashqingizning tayyor javobi emas. Endi shu qolipda o‘z gapingizni yozing 🙂' if locale == 'uz' else
        'These are new examples, not your exercise key. Try your own sentence with the pattern 🙂')
    return {'answer': '\n\n'.join(lines), 'provenance': 'canonical_dictionary', 'citations': [],
        'provider': {'id': 'riwi', 'model': 'riwi-grammar-examples-v1', 'senseId': out.get('senseId')}}
