"""Deterministic IELTS Mock scoring, answer validation, key secrecy, and band policy engine.

Implements Phases 2, 3, 4, and 7 scoring invariants:
- Server-only Listening/Reading 40-question grading against frozen content versions
- Question-type-specific normalization (MCQ single/multi, TFNG, YNNG, matching, completion, short answer)
- Approved aliases only (no synonym guessing), word-limit enforcement, paired-blank deduplication
- Pre-submit answer-key, transcript, and explanation stripping
- Academic vs General Training band conversion tables (version-pinned)
- Writing (Task 1 + 2*Task 2)/3 and Speaking 4-criterion band calculation
- Overall Band calculation ONLY when all 4 section bands exist and are approved/completed (never 0 for pending)
- Asia/Tashkent weekly slot eligibility and server-authoritative section timers
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

TASHKENT_TZ = ZoneInfo('Asia/Tashkent')

SECRET_QUESTION_KEYS = frozenset({
    'correctAnswer', 'correct_answer',
    'acceptedAnswers', 'accepted_answers',
    'alternatives', 'key', 'answerKey', 'answer_key',
    'explanation', 'evidenceQuote', 'evidence_quote',
    'evidence', 'transcript', 'transcriptText', 'transcript_text',
})

SCORE_POLICIES: dict[str, dict[str, Any]] = {
    'listening': {
        'id': 'listening',
        'version': 'v1',
        'total': 40,
        'bands': [
            (9.0, 39, 40), (8.5, 37, 38), (8.0, 35, 36), (7.5, 32, 34),
            (7.0, 30, 31), (6.5, 26, 29), (6.0, 23, 25), (5.5, 18, 22),
            (5.0, 16, 17), (4.5, 13, 15), (4.0, 10, 12), (3.5, 8, 9),
            (3.0, 6, 7), (2.5, 4, 5), (2.0, 3, 3), (1.5, 2, 2),
            (1.0, 1, 1), (0.0, 0, 0),
        ],
    },
    'reading_academic': {
        'id': 'reading_academic',
        'version': 'v1',
        'total': 40,
        'bands': [
            (9.0, 39, 40), (8.5, 37, 38), (8.0, 35, 36), (7.5, 33, 34),
            (7.0, 30, 32), (6.5, 27, 29), (6.0, 23, 26), (5.5, 19, 22),
            (5.0, 15, 18), (4.5, 13, 14), (4.0, 10, 12), (3.5, 8, 9),
            (3.0, 6, 7), (2.5, 4, 5), (2.0, 3, 3), (1.5, 2, 2),
            (1.0, 1, 1), (0.0, 0, 0),
        ],
    },
    'reading_general_training': {
        'id': 'reading_general_training',
        'version': 'v1',
        'total': 40,
        'bands': [
            (9.0, 40, 40), (8.5, 39, 39), (8.0, 37, 38), (7.5, 36, 36),
            (7.0, 34, 35), (6.5, 32, 33), (6.0, 30, 31), (5.5, 27, 29),
            (5.0, 23, 26), (4.5, 19, 22), (4.0, 15, 18), (3.5, 12, 14),
            (3.0, 9, 11), (2.5, 6, 8), (2.0, 4, 5), (1.5, 2, 3),
            (1.0, 1, 1), (0.0, 0, 0),
        ],
    },
}

DEFAULT_SECTION_SECONDS: dict[str, int] = {
    'listening': 30 * 60,
    'reading': 60 * 60,
    'writing': 60 * 60,
    'speaking': 14 * 60,
}

FULL_MOCK_SKILLS = ('listening', 'reading', 'writing', 'speaking')

WRITING_TASK1_CRITERIA = ('task_achievement', 'coherence_cohesion', 'lexical_resource', 'grammar_accuracy')
WRITING_TASK2_CRITERIA = ('task_response', 'coherence_cohesion', 'lexical_resource', 'grammar_accuracy')
SPEAKING_CRITERIA = ('fluency_coherence', 'lexical_resource', 'grammar_accuracy', 'pronunciation')


def sha256_hex(data: bytes | str) -> str:
    if isinstance(data, str):
        data = data.encode('utf-8')
    return hashlib.sha256(data).hexdigest()


def canonical_json_sha256(obj: Any) -> str:
    serialized = json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(',', ':'), default=str)
    return sha256_hex(serialized)


def count_words(text: str | None) -> int:
    if not isinstance(text, str):
        return 0
    cleaned = text.strip()
    if not cleaned:
        return 0
    return len(re.split(r'\s+', cleaned))


def round_half_or_whole(value: float | int | None) -> float | None:
    """Round to nearest 0.5 band; .25 rounds up to .5 and .75 rounds up to 1.0 (official IELTS rule)."""
    if value is None or isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    clamped = min(9.0, max(0.0, float(value)))
    return math.floor(clamped * 2.0 + 0.5) / 2.0


def convert_raw_to_band(skill: str, raw: int | None, total: int = 40, track: str = 'academic') -> dict[str, Any] | None:
    """Convert a Listening or Reading raw score to an IELTS band using versioned tables.
    Returns None if raw is invalid, total != 40, or mapping is missing (never guesses a band).
    """
    if raw is None or isinstance(raw, bool) or not isinstance(raw, int):
        return None
    if skill == 'listening':
        policy_key = 'listening'
    elif skill == 'reading':
        if track in ('general', 'general_training'):
            policy_key = 'reading_general_training'
        elif track in ('academic', 'unspecified', ''):
            policy_key = 'reading_academic'
        else:
            return None
    else:
        return None

    policy = SCORE_POLICIES.get(policy_key)
    if not policy or total != policy['total'] or raw < 0 or raw > policy['total']:
        return None

    for band, low, high in policy['bands']:
        if low <= raw <= high:
            return {
                'band': band,
                'policyId': policy['id'],
                'policyVersion': policy['version'],
                'policyRef': f"{policy['id']}@{policy['version']}",
            }
    return None


def normalize_answer_text(value: Any) -> str:
    if value is None:
        return ''
    text = unicodedata.normalize('NFKC', str(value))
    text = (
        text.replace('\u2018', "'")
        .replace('\u2019', "'")
        .replace('\u02bc', "'")
        .replace('\u2013', '-')
        .replace('\u2014', '-')
        .replace('_', ' ')
    )
    text = re.sub(r'\s+', ' ', text.strip().lower())
    text = re.sub(r'\.$', '', text)
    return text.strip()


def _choice_shape(value: Any) -> tuple[str | None, str]:
    raw = str(value or '').strip()
    if not raw:
        return None, ''
    matched = re.match(r'^((?:[ivx]+|[a-z]))\s*[)—–.:\-]\s*(.+)$', raw, re.I | re.ASCII)
    if matched:
        return matched.group(1).lower(), normalize_answer_text(matched.group(2))
    if re.fullmatch(r'(?:[ivx]+|[a-z])', raw, re.I | re.ASCII):
        return raw.lower(), ''
    return None, normalize_answer_text(raw)


def _choice_matches(answer: str, key: str, options: list[Any] | None = None) -> bool:
    left_label, left_text = _choice_shape(answer)
    right_label, right_text = _choice_shape(key)
    if not left_label and not left_text:
        return False
    if left_label and right_label:
        return left_label == right_label
    if left_text and right_text:
        return left_text == right_text

    formatted_options: list[tuple[str, str]] = []
    for idx, opt in enumerate(options or []):
        opt_label, opt_body = _choice_shape(opt)
        label = opt_label or chr(97 + idx)
        body = opt_body or normalize_answer_text(opt)
        formatted_options.append((label, body))

    if left_label and right_text:
        return any(lbl == left_label and body == right_text for lbl, body in formatted_options)
    if right_label and left_text:
        return any(lbl == right_label and body == left_text for lbl, body in formatted_options)
    return False


def _canonical_question_kind(raw_kind: str | None) -> str:
    k = (raw_kind or '').strip().lower().replace('-', '_').replace(' ', '_')
    if k in ('tfng', 'true_false_not_given', 'true_false_ng'):
        return 'true_false_not_given'
    if k in ('ynng', 'yes_no_not_given', 'yes_no_ng'):
        return 'yes_no_not_given'
    if k in ('mcq', 'multiple_choice', 'mcq_single', 'multiple_choice_single'):
        return 'multiple_choice'
    if k in ('multiple_choice_multi', 'mcq_multi', 'choose_two', 'choose_three') or k.endswith('choose_two') or k.endswith('choose_three'):
        return 'multiple_choice_multi'
    if k.startswith('matching') or k in ('classification', 'map', 'map_labelling', 'diagram_labelling'):
        return 'matching'
    if k in ('short_answer', 'short_answers'):
        return 'short_answer'
    return 'completion'


def grade_mock_question(
    question: dict[str, Any],
    student_answer: Any,
    *,
    shared_choices: list[Any] | None = None,
    all_questions_by_number: dict[int, dict[str, Any]] | None = None,
    all_answers_by_number: dict[int, str] | None = None,
) -> bool:
    """Deterministically grade a single Listening or Reading question against its frozen key."""
    if not isinstance(student_answer, str):
        student_answer = '' if student_answer is None else str(student_answer)
    raw_trimmed = student_answer.strip()
    if not raw_trimmed:
        return False

    constraints = question.get('answer_constraint') or question.get('answerConstraint') or {}
    if isinstance(constraints, str):
        try:
            constraints = json.loads(constraints)
        except ValueError:
            constraints = {}

    max_words = constraints.get('max_words', constraints.get('maxWords', question.get('max_words', question.get('maxWords'))))
    word_count = count_words(raw_trimmed)
    if isinstance(max_words, (int, float)) and max_words > 0 and word_count > int(max_words):
        return False

    raw_type = question.get('type_code') or question.get('typeCode') or question.get('type') or question.get('kind') or 'completion'
    kind = _canonical_question_kind(str(raw_type))

    primary_key = question.get('correct_answer')
    if primary_key is None:
        primary_key = question.get('correctAnswer')
    if primary_key is None:
        primary_key = question.get('key')
    primary_key_str = '' if primary_key is None else str(primary_key)

    accepted = (
        question.get('accepted_answers')
        or question.get('acceptedAnswers')
        or question.get('alternatives')
        or []
    )
    if isinstance(accepted, str):
        try:
            accepted = json.loads(accepted)
        except ValueError:
            accepted = [accepted]
    if not isinstance(accepted, list):
        accepted = []

    pair_numbers = question.get('pair') or []
    q_number = question.get('order') or question.get('question_no') or question.get('questionNo') or question.get('number')
    if pair_numbers and all_questions_by_number and isinstance(q_number, int):
        for partner_no in pair_numbers:
            if partner_no in all_questions_by_number:
                partner_key = (
                    all_questions_by_number[partner_no].get('key')
                    or all_questions_by_number[partner_no].get('correct_answer')
                    or all_questions_by_number[partner_no].get('correctAnswer')
                )
                if partner_key:
                    accepted = [*accepted, str(partner_key)]
        if all_answers_by_number:
            norm_curr = normalize_answer_text(raw_trimmed)
            if any(
                int(p) < q_number and normalize_answer_text(all_answers_by_number.get(int(p), '')) == norm_curr
                for p in pair_numbers
            ):
                return False

    all_keys = [primary_key_str, *(str(x) for x in accepted if x is not None and str(x).strip())]
    all_keys = [k for k in all_keys if k.strip()]
    if not all_keys:
        return False

    options = question.get('options') or shared_choices or []
    if isinstance(options, str):
        try:
            options = json.loads(options)
        except ValueError:
            options = []

    if kind in ('true_false_not_given', 'yes_no_not_given'):
        allowed = constraints.get('allowed_values') or constraints.get('allowedValues')
        if isinstance(allowed, list) and all(isinstance(v, str) for v in allowed):
            allowed_set = {re.sub(r'\s+', '_', v.strip().upper()) for v in allowed}
            if allowed_set == {'YES', 'NO', 'NOT_GIVEN'}:
                kind = 'yes_no_not_given'
            elif allowed_set == {'TRUE', 'FALSE', 'NOT_GIVEN'}:
                kind = 'true_false_not_given'
        valid_tokens = ('YES', 'NO', 'NOT GIVEN') if kind == 'yes_no_not_given' else ('TRUE', 'FALSE', 'NOT GIVEN')
        candidate = re.sub(r'\s+', ' ', raw_trimmed.replace('_', ' ').upper())
        expected = re.sub(r'\s+', ' ', primary_key_str.strip().replace('_', ' ').upper())
        return candidate in valid_tokens and candidate == expected

    if kind == 'multiple_choice_multi':
        split_tokens = lambda s: [x.strip() for x in re.split(r'[,;]|\s+and\s+', s, flags=re.I) if x.strip()]
        provided = split_tokens(raw_trimmed)
        if not provided or len({x.lower() for x in provided}) != len(provided):
            return False
        for expected_raw in all_keys:
            expected_tokens = split_tokens(expected_raw)
            required_count = constraints.get('selection_count', len(expected_tokens))
            if len(provided) != required_count or len(expected_tokens) != required_count:
                continue
            remaining = list(expected_tokens)
            for item in provided:
                matched_idx = next((i for i, k in enumerate(remaining) if _choice_matches(item, k, options)), None)
                if matched_idx is not None:
                    remaining.pop(matched_idx)
            if not remaining:
                return True
        return False

    if kind == 'multiple_choice':
        return any(_choice_matches(raw_trimmed, k, options) for k in all_keys)

    if kind == 'matching':
        return any(_choice_matches(raw_trimmed, k, options) or normalize_answer_text(raw_trimmed) == normalize_answer_text(k) for k in all_keys)

    # Completion / short answer: default 3-word limit on completion when no explicit max_words is set
    if kind == 'completion' and not isinstance(max_words, (int, float)) and word_count > 3:
        return False

    norm_student = normalize_answer_text(raw_trimmed)
    return any(norm_student == normalize_answer_text(k) for k in all_keys)


def grade_mock_section(
    skill: str,
    questions: list[dict[str, Any]],
    answers_by_id: dict[str, str],
    *,
    track: str = 'academic',
    groups_by_id: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Grade a 40-question Listening or Reading section deterministically."""
    if skill not in ('listening', 'reading'):
        raise ValueError(f'Unsupported deterministic grading skill: {skill}')

    by_number: dict[int, dict[str, Any]] = {}
    answers_by_number: dict[int, str] = {}
    for idx, q in enumerate(questions, 1):
        q_num = int(q.get('order') or q.get('question_no') or q.get('questionNo') or q.get('number') or idx)
        by_number[q_num] = q
        qid = str(q.get('id') or q_num)
        answers_by_number[q_num] = str(answers_by_id.get(qid, answers_by_id.get(str(q_num), '')) or '')

    raw_score = 0
    graded_items: list[dict[str, Any]] = []
    canonical_answers: dict[str, str] = {}

    for idx, q in enumerate(questions, 1):
        qid = str(q.get('id') or idx)
        q_num = int(q.get('order') or q.get('question_no') or q.get('questionNo') or q.get('number') or idx)
        ans = str(answers_by_id.get(qid, answers_by_id.get(str(q_num), '')) or '')
        canonical_answers[qid] = ans
        group_id = str(q.get('group_id') or q.get('groupId') or '')
        shared_choices = None
        if groups_by_id and group_id in groups_by_id:
            shared_choices = groups_by_id[group_id].get('shared_choices') or groups_by_id[group_id].get('sharedChoices')
        is_correct = grade_mock_question(
            q,
            ans,
            shared_choices=shared_choices,
            all_questions_by_number=by_number,
            all_answers_by_number=answers_by_number,
        )
        if is_correct:
            raw_score += 1
        graded_items.append({
            'questionId': qid,
            'number': q_num,
            'isCorrect': bool(is_correct),
        })

    total_questions = len(questions)
    band_info = convert_raw_to_band(skill, raw_score, total=total_questions, track=track)
    return {
        'skill': skill,
        'rawScore': raw_score,
        'scoreMax': total_questions,
        'band': band_info['band'] if band_info else None,
        'policyRef': band_info['policyRef'] if band_info else None,
        'answerHash': canonical_json_sha256(canonical_answers),
        'items': graded_items,
    }


def sanitize_question_for_exam(question: dict[str, Any]) -> dict[str, Any]:
    """Strip answer keys, explanations, and evidence quotes from exam runner payloads."""
    return {k: v for k, v in question.items() if k not in SECRET_QUESTION_KEYS}


def sanitize_section_payload_for_exam(payload: dict[str, Any]) -> dict[str, Any]:
    """Recursively strip answer keys, transcripts, and explanations from a section payload before final submission."""
    cleaned: dict[str, Any] = {}
    for k, v in payload.items():
        if k in SECRET_QUESTION_KEYS:
            continue
        if isinstance(v, dict):
            cleaned[k] = sanitize_section_payload_for_exam(v)
        elif isinstance(v, list):
            cleaned[k] = [
                sanitize_section_payload_for_exam(item) if isinstance(item, dict) else item
                for item in v
            ]
        else:
            cleaned[k] = v
    return cleaned


def _validate_criterion_int(value: Any) -> int | None:
    if value is None or isinstance(value, bool) or not isinstance(value, int):
        return None
    if 0 <= value <= 9:
        return value
    return None


def compute_writing_bands(
    task1_criteria: dict[str, Any] | None,
    task2_criteria: dict[str, Any] | None,
) -> dict[str, float | None]:
    """Compute Task 1 estimate, Task 2 estimate, weighted raw, and rounded Writing band.
    Returns None for bands if any required criterion is missing or invalid (never substitutes 0).
    """
    if not isinstance(task1_criteria, dict) or not isinstance(task2_criteria, dict):
        return {'task1Band': None, 'task2Band': None, 'weightedRaw': None, 'band': None}

    t1_vals = [_validate_criterion_int(task1_criteria.get(k)) for k in WRITING_TASK1_CRITERIA]
    t2_vals = [_validate_criterion_int(task2_criteria.get(k)) for k in WRITING_TASK2_CRITERIA]

    if any(v is None for v in t1_vals) or any(v is None for v in t2_vals):
        return {'task1Band': None, 'task2Band': None, 'weightedRaw': None, 'band': None}

    t1_mean = sum(v for v in t1_vals if v is not None) / 4.0
    t2_mean = sum(v for v in t2_vals if v is not None) / 4.0
    weighted = (t1_mean + 2.0 * t2_mean) / 3.0
    return {
        'task1Band': round(t1_mean, 2),
        'task2Band': round(t2_mean, 2),
        'weightedRaw': round(weighted, 4),
        'band': round_half_or_whole(weighted),
    }


def compute_speaking_band(criteria: dict[str, Any] | None) -> dict[str, float | None]:
    """Compute Speaking estimate from the 4 official criteria (0..9 integers)."""
    if not isinstance(criteria, dict):
        return {'meanRaw': None, 'band': None}
    vals = [_validate_criterion_int(criteria.get(k)) for k in SPEAKING_CRITERIA]
    if any(v is None for v in vals):
        return {'meanRaw': None, 'band': None}
    mean_val = sum(v for v in vals if v is not None) / 4.0
    return {
        'meanRaw': round(mean_val, 2),
        'band': round_half_or_whole(mean_val),
    }


def compute_overall_mock_band(section_bands: dict[str, float | int | None]) -> float | None:
    """Compute overall band ONLY when all 4 section bands (L, R, W, S) exist and are valid.
    Never substitutes 0 for a pending or missing section.
    """
    if not isinstance(section_bands, dict):
        return None
    values: list[float] = []
    for skill in FULL_MOCK_SKILLS:
        val = section_bands.get(skill)
        if val is None or isinstance(val, bool) or not isinstance(val, (int, float)) or not math.isfinite(val):
            return None
        if val < 0 or val > 9:
            return None
        values.append(float(val))
    return round_half_or_whole(sum(values) / 4.0)


def compute_writing_source_sha256(
    attempt_id: str,
    task1_prompt: str,
    task1_answer: str,
    task1_media_sha256: str | None,
    task2_prompt: str,
    task2_answer: str,
) -> dict[str, str]:
    """Compute deterministic per-task and combined canonical SHA-256 digests for Writing."""
    t1_sha = sha256_hex(task1_answer)
    t2_sha = sha256_hex(task2_answer)
    combined = canonical_json_sha256({
        'schema': 'la.mock.writing.source.v1',
        'attempt_id': str(attempt_id),
        'task1_prompt_sha256': sha256_hex(task1_prompt),
        'task1_answer_sha256': t1_sha,
        'task1_media_sha256': task1_media_sha256 or '',
        'task2_prompt_sha256': sha256_hex(task2_prompt),
        'task2_answer_sha256': t2_sha,
    })
    return {
        'task1Sha256': t1_sha,
        'task2Sha256': t2_sha,
        'sourceSha256': combined,
    }


def compute_speaking_source_sha256(
    attempt_id: str,
    parts: list[dict[str, Any]],
) -> str:
    """Compute deterministic canonical SHA-256 digest for a 3-part Speaking submission."""
    question_capture=any(p.get('question_id') for p in parts)
    normalized_parts = [
        {
            'part': str(p.get('part') or ''),
            'sha256': str(p.get('sha256') or ''),
            'bytes': int(p.get('bytes') or 0),
            'duration_ms': int(p.get('duration_ms') or p.get('durationMs') or 0),
            'question_ids': [str(q) for q in (p.get('question_ids') or p.get('questionIds') or [])],
            **({'transcript_sha256':canonical_json_sha256(p.get('transcript_capture') or {})}
               if question_capture else {}),
        }
        for p in sorted(parts, key=lambda x: (str(x.get('part') or ''),str(x.get('question_id') or '')))
    ]
    return canonical_json_sha256({
        'schema': 'la.mock.speaking.source.v2' if question_capture else 'la.mock.speaking.source.v1',
        'attempt_id': str(attempt_id),
        'parts': normalized_parts,
    })


def current_weekly_slot(now: datetime | None = None) -> str:
    """Return ISO weekly slot (e.g. '2026-W44') in centre timezone (Asia/Tashkent)."""
    dt = (now or datetime.now(timezone.utc)).astimezone(TASHKENT_TZ)
    iso_year, iso_week, _ = dt.isocalendar()
    return f'{iso_year}-W{iso_week:02d}'


def compute_attempt_schedule_plan(
    started_at: datetime,
    sections: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Derive server-authoritative cumulative section windows and deadlines from attempt start."""
    if started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=timezone.utc)
    cursor = 0
    plan_sections: list[dict[str, Any]] = []
    ordered_skills = sections or [{'skill': s} for s in FULL_MOCK_SKILLS]
    seen_skills: list[tuple[str, int]] = []
    for s in ordered_skills:
        sk = str(s.get('skill') or '')
        if not sk:
            continue
        sec = int(s.get('seconds') or DEFAULT_SECTION_SECONDS.get(sk, 1800))
        if seen_skills and seen_skills[-1][0] == sk:
            # Task 1 + Task 2 share one Writing section, including BOTH durations.
            if sk == 'writing':
                seen_skills[-1] = (sk, seen_skills[-1][1] + sec)
            continue
        seen_skills.append((sk, sec))

    if not seen_skills:
        seen_skills = [(s, DEFAULT_SECTION_SECONDS[s]) for s in FULL_MOCK_SKILLS]

    deadlines: dict[str, str] = {}
    for pos, (sk, sec) in enumerate(seen_skills, 1):
        start_dt = started_at + timedelta(seconds=cursor)
        end_dt = started_at + timedelta(seconds=cursor + sec)
        plan_sections.append({
            'position': pos,
            'skill': sk,
            'seconds': sec,
            'startsAtSeconds': cursor,
            'endsAtSeconds': cursor + sec,
            'startsAt': start_dt.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z'),
            'deadlineAt': end_dt.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z'),
        })
        deadlines[sk] = end_dt.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
        cursor += sec

    overall_deadline = started_at + timedelta(seconds=cursor)
    return {
        'sections': plan_sections,
        'sectionDeadlines': deadlines,
        'totalSeconds': cursor,
        'deadlineAt': overall_deadline.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z'),
    }
