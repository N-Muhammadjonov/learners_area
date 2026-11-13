"""Bounded social intent examples and same-user, same-chat follow-ups."""
from functools import lru_cache
import json
from pathlib import Path
from .riwi_uzbek import normalize_query


@lru_cache(maxsize=1)
def pack():
    data = json.loads((Path(__file__).resolve().parents[1] / 'contracts/riwi_dialogues_v1.json').read_text())
    if data.get('version') != 'riwi-dialogues-v1' or len(data.get('entries', [])) != 120:
        raise ValueError('invalid_dialogue_pack')
    return data


@lru_cache(maxsize=1)
def indexes():
    by_id, exact = {}, {}
    for entry in pack()['entries']:
        by_id[entry['id']] = entry
        for locale in ('uz', 'en'):
            exact[normalize_query(entry['turns'][0][locale])] = entry
    aliases = {'egang kim': 'identity.02', 'sening egang kim': 'identity.02', 'who is your owner': 'identity.02',
        'sen kimsen': 'identity.01', 'siz kimsiz': 'identity.01', 'nima qilyapsiz': 'daily.01', 'sen nima qilyapsan': 'daily.01',
        'yaxshimisiz': 'feelings.02', 'qalaysiz': 'feelings.01', 'xayrli tong': 'greeting.04'}
    for query, identifier in aliases.items(): exact.setdefault(normalize_query(query), by_id[identifier])
    return by_id, exact


async def reply(conn, actor, message, locale, conversation_id=None):
    from .riwi_capabilities import authorize_capability
    if not authorize_capability(actor, 'riwi.chat.self').allowed: return None
    by_id, exact = indexes()
    q = normalize_query(message)
    selected = exact.get(q)
    turn = 1
    if conversation_id and conn is not None and hasattr(conn, 'fetchrow'):
        # previous_context checks ownership, original role and retention again;
        # a user cannot supply a dialogue ID to impersonate someone else's chat.
        from .riwi_material_search import previous_context
        previous = await previous_context(conn, actor, conversation_id)
        if previous.get('model') == 'riwi-dialogues-v1':
            entry = by_id.get(previous.get('dialogueId'))
            if entry and q in [normalize_query(entry['turns'][2][lang]) for lang in ('uz', 'en')]:
                selected, turn = entry, 3
        elif not selected or selected['topic'] == 'confusion':
            from .riwi_curriculum import is_followup
            if is_followup(message):
                if previous.get('model') == 'riwi-new-questions-v1':
                    from .riwi_new_questions import pack as questions, reply as question_reply
                    entry = next((e for e in questions()['entries'] if e['id'] == previous.get('questionId')), None)
                    if entry: return question_reply(actor, entry['questions'][locale], locale)
                if previous.get('model') == 'riwi-site-grammar-v1':
                    from .riwi_site_grammar import reply as grammar_reply
                    return grammar_reply(actor, str(previous.get('grammarUnitId', '')), locale)
                if previous.get('model') == 'riwi-help-v1' and previous.get('helpId'):
                    from .riwi_help import BY_ID, reply as help_reply
                    entry = BY_ID.get(previous['helpId'])
                    if entry: return help_reply(actor, entry['questions'][0 if locale == 'uz' else 1], locale)
    if not selected: return None
    # Let established grammar/material tutors handle their own contextual
    # simplification requests; generic social clarification must not steal them.
    if selected['topic'] == 'confusion' and conversation_id and conn is not None and hasattr(conn, 'fetchrow'):
        if previous.get('model', '').startswith(('riwi-curriculum-', 'riwi-study-', 'riwi-reference-', 'riwi-material-')):
            return None
    return {'answer': selected['turns'][turn][locale], 'provenance': 'deterministic_learning_data', 'citations': [],
        'provider': {'id': 'riwi', 'model': 'riwi-dialogues-v1', 'dialogueId': selected['id'], 'dialogueTurn': turn}}
