"""Practice topic tiers and immutable, ordered Speaking practice selections."""
from __future__ import annotations

import json
import re
import secrets
from typing import Any

# Explicit topic assignments from the existing numbered bank. These are practice
# tiers based on topic demands, never certified CEFR levels or IELTS band scores.
P1_BEGINNER = frozenset((1,2,3,4,5,6,7,8,9,10,16,19,21,22,23,24,33,34,35,38,39,40,41,42,43,44,45,46,47,48,49,50,53,54,55,56,58,60,61,62,63,64,71,72,73,75,78,79,82,83,85,87,88,89,91,92,93,94,95,96,97,98,100,101,102,103,104,105,106,107,108,109,111,115,116,118,122,123,124,126,130,131,132,135,137,139,140,141,142,143,144,145,146,147,148,149,155,156,157,160,161,162,163,164,165,166,169,181,182,184,187,189,190,191,192,193,194,195,196,197,198,200,201))
P1_ADVANCED = frozenset((15,27,28,29,30,31,32,57,66,67,70,86,99,119,120,127,128,150,151,153,158,170,172,173,174,175,176,178,179,180,183,186,202,203,204,205,206))
PAIR_BEGINNER = frozenset((2,3,5,6,16,26,27,30,31,36,39,43,49,54,56,61,67,70,71,76,77,80,89,90,91,92,93,94,95,96,97,98,101,102,106,107,108,114,122,127,128,129,131,138,141,142,143,144,146,148,151,159,160,162))
PAIR_ADVANCED = frozenset((4,9,11,15,19,20,21,22,24,28,29,33,53,58,63,64,68,73,75,78,79,84,85,86,88,99,104,109,110,111,113,118,126,132,133,136,145,147,150,152,153,154,155,158,163,164,165,166))
LEVELS = frozenset(('beginner', 'intermediate', 'advanced'))


def topic_level(row: dict[str, Any]) -> str | None:
    """Use explicit editorial metadata first, then the numbered source assignment."""
    support = row.get('study_support') or {}
    if isinstance(support, str):
        support = json.loads(support)
    explicit = support.get('fluencyLevel') if isinstance(support, dict) else None
    if explicit in LEVELS:
        return explicit
    match = re.match(r'^(\d{3})[.]', str(row.get('topic') or ''))
    if not match:
        return None
    number = int(match[1])
    first = str(row.get('part')) == 'part1'
    if not 1 <= number <= (206 if first else 166):
        return None
    beginner, advanced = (P1_BEGINNER, P1_ADVANCED) if first else (PAIR_BEGINNER, PAIR_ADVANCED)
    return 'beginner' if number in beginner else 'advanced' if number in advanced else 'intermediate'


def choose_session(rows: list[dict[str, Any]], level: str, excluded: set[str] | None = None) -> list[dict[str, Any]]:
    if level not in LEVELS:
        raise ValueError('invalid_level')
    excluded = excluded or set()
    topics: dict[str, list[dict[str, Any]]] = {}
    part2, part3 = [], {}

    def question(row: dict[str, Any]) -> dict[str, Any]:
        return {'id': str(row['id']), 'part': row['part'], 'topic': row['topic'],
                'promptText': row['prompt_text'], 'cueCard': row.get('cue_card'), 'difficulty': level}

    for row in rows:
        if not row.get('prompt_text') or topic_level(row) != level:
            continue
        if row['part'] == 'part1':
            topics.setdefault(row['topic'], []).append(question(row))
        elif row['part'] == 'part2':
            part2.append(row)
        elif row['part'] == 'part3':
            source = re.match(r'^s166-(\d{3})-part3-', str(row.get('external_id') or ''))
            if source:
                part3[(source[1], row['prompt_text'].strip())] = question(row)
    pairs = []
    for row in part2:
        source = re.match(r'^s166-(\d{3})-part2-', str(row.get('external_id') or ''))
        followups = row.get('follow_ups') or []
        if isinstance(followups, str):
            followups = json.loads(followups)
        if not source or not isinstance(followups, list):
            continue
        linked = [part3[(source[1], text.strip())] for text in followups
                  if isinstance(text, str) and (source[1], text.strip()) in part3]
        if linked:
            pairs.append([question(row), *linked])
    if len(topics) < 3 or not pairs:
        raise ValueError('question_empty')
    available = list(topics.values())
    fresh = [topic for topic in available if not any(q['id'] in excluded for q in topic)]
    if len(fresh) >= 3:
        available = fresh
    chosen = []
    for _ in range(3):
        topic = secrets.choice(available)
        chosen.extend(topic)
        available = [item for item in available if item is not topic]
    fresh_pairs = [pair for pair in pairs if not any(q['id'] in excluded for q in pair)]
    return [*chosen, *secrets.choice(fresh_pairs or pairs)]
