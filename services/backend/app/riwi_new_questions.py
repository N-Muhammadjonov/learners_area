"""Reviewed procedural FAQ. User text is routing data, never authority."""
from functools import lru_cache
import json
import math
from pathlib import Path
import re
from .riwi_uzbek import normalize_query
from .riwi_capabilities import authorize_capability


@lru_cache(maxsize=1)
def pack():
    data = json.loads((Path(__file__).resolve().parents[1] / 'contracts/riwi_new_questions_v1.json').read_text())
    if data.get('version') != 'riwi-new-questions-v1' or len(data.get('entries', [])) != 200:
        raise ValueError('invalid_new_question_pack')
    for entry in data['entries']:
        if len(entry['queries']) != 5 or any(not 30 <= len(entry['answer'][lang]) <= 5800 for lang in ('uz', 'en')):
            raise ValueError('invalid_new_question_answer')
    return data


@lru_cache(maxsize=1)
def exact_index():
    result = {}
    for entry in pack()['entries']:
        for query in entry['queries']:
            result.setdefault(normalize_query(query), []).append(entry)
    return result


STOP = frozenset(('how what should when asks says that do does can could i me my the a an is are in on at to for of and or please '
    'menga men meni bu shu qanday qanaqa qilib bilan uchun haqida iltimos nima degan degani '
    'ber bering tushuntir ayt explain tell help question savol savolda').split())
CONCEPTS = {
    'two': '2', 'ikkita': '2', 'ikki': '2', 'three': '3', 'uchta': '3', 'uch': '3',
    'four': '4', 'tortta': '4', 'one': '1', 'bitta': '1', 'bir': '1',
    'choose': 'select', 'tanlash': 'select', 'tanlayman': 'select', 'belgilayman': 'select',
    'tanlay': 'select', 'belgilash': 'select', 'selecting': 'select',
    'answers': 'answer', 'javob': 'answer', 'variant': 'option', 'variantlar': 'option', 'options': 'option',
    'spiker': 'speaker', 'audio': 'recording', 'oxirgi': 'final', 'yakuniy': 'final',
    'fikr': 'opinion', 'tuzatish': 'correction', 'tuzatilsa': 'correction', 'corrects': 'correction',
    'corrected': 'correction', 'correcting': 'correction', 'tuzatsa': 'correction',
    'avval': 'earlier', 'oldingi': 'earlier', 'earlier': 'earlier', 'keyin': 'later',
    'number': 'raqam', 'numbers': 'raqam', 'son': 'raqam', 'raqami': 'raqam',
    'farq': 'difference', 'farqlayman': 'difference', 'distinguish': 'difference',
}


@lru_cache(maxsize=4096)
def features(message):
    q = normalize_query(message)
    words = {CONCEPTS.get(x, x) for x in q.split() if x not in STOP}
    return frozenset(words)


def intent_kind(message):
    q = normalize_query(message)
    if re.search(r'\b(?:why|nega|nimaga)\b|nima uchun', q): return 'reason'
    if re.search(r'\b(?:how|qanday|qanaqa)\b', q): return 'method'
    return None


def constraints(message):
    q = features(message)
    # Do not discard numerals, polarity or words that can reverse a task.
    return (frozenset(w for w in q if w.isdigit()),
        frozenset(w for w in q if w in {'not', 'no', 'never', 'aytilmagan', 'emas', 'without'}))


@lru_cache(maxsize=1)
def semantic_index():
    rows, inverted, frequency = [], {}, {}
    for entry in pack()['entries']:
        combined = set()
        for question in entry['queries']:
            words = features(question)
            row = len(rows)
            rows.append((entry, words, constraints(question), intent_kind(question)))
            combined.update(words)
            for word in words: inverted.setdefault(word, set()).add(row)
        for word in combined: frequency[word] = frequency.get(word, 0) + 1
    weights = {word: 1 + math.log(201 / (1 + count)) for word, count in frequency.items()}
    return rows, inverted, weights


def find(message):
    matches = exact_index().get(normalize_query(message), [])
    if matches:
        return matches[0] if len({e['id'] for e in matches}) == 1 else None
    words = features(message)
    if len(words) < 3: return None
    rows, inverted, weights = semantic_index()
    candidates = set().union(*(inverted.get(w, set()) for w in words))
    scores = {}
    constraint = constraints(message)
    kind = intent_kind(message)
    for index in candidates:
        entry, target, limits, target_kind = rows[index]
        if limits != constraint or kind and target_kind and kind != target_kind: continue
        shared = words & target
        if len(shared) < 3: continue
        hit = sum(weights[w] for w in shared)
        coverage = hit / sum(weights.get(w, 7) for w in words)
        completeness = hit / sum(weights[w] for w in target)
        if coverage < .8 or completeness < .65: continue
        score = .65 * coverage + .35 * completeness
        if score > scores.get(entry['id'], (0, None))[0]: scores[entry['id']] = (score, entry)
    ranked = sorted(scores.values(), key=lambda x: x[0], reverse=True)
    return ranked[0][1] if ranked and ranked[0][0] >= .84 and (len(ranked) == 1 or ranked[0][0] - ranked[1][0] >= .12) else None


def allowed(actor, entry):
    return actor.role in entry['roles'] and authorize_capability(actor, 'riwi.chat.self').allowed


def reply(actor, message, locale):
    entry = find(message)
    if not entry:
        return None
    permitted = allowed(actor, entry)
    answer = entry['answer'][locale] if permitted else (
        'Bu bo‘lim vazifalari rolingiz doirasiga kirmaydi. O‘zingizga ochiq bo‘limning ishlatilishini tushuntira olaman.'
        if locale == 'uz' else 'That workflow is outside your role. I can explain a section available to your account.')
    return {'answer': answer, 'provenance': 'deterministic_learning_data' if permitted else 'policy_refusal',
        'citations': [], 'provider': {'id': 'riwi', 'model': 'riwi-new-questions-v1', 'questionId': entry['id']}}
