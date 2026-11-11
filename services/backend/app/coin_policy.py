"""Versioned coin rules.

Pure functions only. Client timestamps, localStorage and claimed amounts are
not evidence. Callers pass server-observed facts.
"""
from __future__ import annotations

from datetime import datetime

POLICY_VERSION = "coin-economy-v1"
BUCKET_MS = 300_000
MIN_WALL_S = 5.0
MAX_WALL_S = 20.0
MIN_RATE = 0.5
MAX_RATE = 2.0
JITTER = 1.15
DAILY_MEDIA_COINS = 20
MEDIA_ITEM_DAILY_CAP = 6
SPEAKING_SESSION_CAP = 6
SPEAKING_DAILY_CAP = 12
SHORT_MEDIA_RATIO = 0.80
LEVELS = (0, 10, 25, 50, 100, 175, 275, 400, 550, 750)
LEVEL_STEP = 250


def coin_level(lifetime: int) -> int:
    earned = max(0, int(lifetime))
    level = 1
    for index, threshold in enumerate(LEVELS, start=1):
        if earned >= threshold:
            level = index
    if earned > LEVELS[-1]:
        level += (earned - LEVELS[-1]) // LEVEL_STEP
    return level


def next_level_at(lifetime: int) -> int | None:
    earned = max(0, int(lifetime))
    for threshold in LEVELS:
        if earned < threshold:
            return threshold
    return LEVELS[-1] + (1 + (earned - LEVELS[-1]) // LEVEL_STEP) * LEVEL_STEP


def answers_complete(answers) -> bool:
    """A reward needs every required response, not a perfect score."""
    if not isinstance(answers, (list, tuple)) or not answers:
        return False
    return all(isinstance(item, str) and item.strip() for item in answers)


def vocab_milestone_coins(mastered_count: int) -> int:
    return max(0, int(mastered_count)) // 5


def cap_allows(*, module: str, media_today: int = 0, item_today: int = 0,
               speaking_today: int = 0, session_today: int = 0) -> bool:
    if module in ("ted", "podcast"):
        return media_today < DAILY_MEDIA_COINS and item_today < MEDIA_ITEM_DAILY_CAP
    if module == "speaking":
        return speaking_today < SPEAKING_DAILY_CAP and session_today < SPEAKING_SESSION_CAP
    return True


def credit_timeline(coverage: dict, paid: set, start_ms: int, credit_ms: int) -> list[int]:
    """Add verified content time. A full 5-minute slice pays once."""
    newly = []
    if credit_ms <= 0:
        return newly
    cursor = max(0, int(start_ms))
    end_ms = cursor + int(credit_ms)
    while cursor < end_ms:
        bucket = cursor // BUCKET_MS
        boundary = (bucket + 1) * BUCKET_MS
        span = min(end_ms, boundary) - cursor
        have = int(coverage.get(bucket, 0))
        room = max(0, BUCKET_MS - have)
        added = min(span, room)
        if added:
            coverage[bucket] = have + added
            if coverage[bucket] >= BUCKET_MS and bucket not in paid:
                paid.add(bucket)
                newly.append(bucket)
        cursor += span
    return newly


def short_media_ready(duration_ms: int | None, credited_ms: int, position_ms: int) -> bool:
    if not duration_ms or duration_ms <= 0 or duration_ms >= BUCKET_MS:
        return False
    needed = int(duration_ms * SHORT_MEDIA_RATIO)
    return credited_ms >= needed and position_ms >= needed


MEDIA_SLICE_MS = 5_000


def add_unique_media_coverage(coverage: dict, start_ms: int, end_ms: int,
                              rate: float, wall_ms: int) -> int:
    """Count active wall time once per small content slice, even on replay.

    Coverage values are wall milliseconds, not video-position milliseconds.
    Repeated content is not added twice. Partial replay is handled
    conservatively using the maximum credited value for each slice.
    """
    if end_ms <= start_ms or rate <= 0 or wall_ms <= 0:
        return 0
    length = end_ms - start_ms
    budget = min(int(wall_ms), int(length / rate))
    added = 0
    cursor = start_ms
    while cursor < end_ms:
        bucket = cursor // MEDIA_SLICE_MS
        edge = min(end_ms, (bucket + 1) * MEDIA_SLICE_MS)
        span = edge - cursor
        candidate = min(int(MEDIA_SLICE_MS / rate), int(budget * span / length))
        prior = max(0, int(coverage.get(bucket, 0)))
        if candidate > prior:
            coverage[bucket] = candidate
            added += candidate - prior
        cursor = edge
    return added


def advance_playback(state: dict | None, now: datetime, *, position_ms: int,
                     playback_rate: float, playing: bool, duration_ms: int | None = None) -> dict:
    """Server clock only. Seeking, pauses and stale tabs credit nothing."""
    position_ms = max(0, int(position_ms))
    rate = float(playback_rate or 0)
    if state is None:
        return {"state": {"at": now, "position": position_ms, "coverage": {}, "paid": set(), "credited": 0},
                "credit_ms": 0, "buckets": [], "short": False}
    wall = (now - state["at"]).total_seconds()
    coverage = dict(state["coverage"])
    paid = set(state["paid"])
    credited = int(state["credited"])
    anchor = {"at": now, "position": position_ms, "coverage": coverage, "paid": paid, "credited": credited}
    if wall < MIN_WALL_S or wall > MAX_WALL_S or not playing or rate < MIN_RATE or rate > MAX_RATE:
        return {"state": anchor, "credit_ms": 0, "buckets": [], "short": False}
    delta = position_ms - int(state["position"])
    ceiling = wall * rate * 1000 * JITTER + 750
    if delta <= 0 or delta > ceiling:
        return {"state": anchor, "credit_ms": 0, "buckets": [], "short": False}
    credit = add_unique_media_coverage(
        coverage, int(state["position"]), position_ms, rate, int(wall * 1000))
    credited += credit
    total_unique_wall_ms = sum(int(value) for value in coverage.values())
    buckets = [index for index in range(1, total_unique_wall_ms // BUCKET_MS + 1)
               if index not in paid]
    anchor.update(coverage=coverage, paid=paid, credited=credited)
    short = short_media_ready(duration_ms, total_unique_wall_ms, position_ms) and "short" not in paid
    # Returned state tracks pending milestones locally. Only the database ledger
    # makes a claim durable; the next request re-reads committed awards.
    paid.update(buckets)
    if short:
        paid.add("short")
    return {"state": anchor, "credit_ms": credit, "buckets": buckets, "short": short}


def grammar_required(exercise: dict) -> tuple[str, int, int]:
    """Return kind, required non-empty answers, and minimum words for writing."""
    kind = str(exercise.get("kind") or "")
    items = exercise.get("items") or []
    if kind == "speak":
        return kind, 0, 0
    if kind == "write":
        return kind, 1, int(exercise.get("min") or 1)
    if kind == "bank":
        needed = 0
        for item in items:
            answers = item.get("a")
            needed += len(answers) if isinstance(answers, list) else 1
        return kind, needed, 0
    return kind, len(items), 0


def grammar_submission_ok(exercise: dict, answers) -> bool:
    """Validate the authored exercise, not just a client-supplied answer count.

    Wrong but legitimate answers count as an attempt. Fabricated options, missing
    responses, and unsupported audio never create completion evidence.
    """
    from collections import Counter

    kind, needed, minimum = grammar_required(exercise)
    items = exercise.get("items") or []
    if kind == "speak" or needed <= 0 or not isinstance(answers, list) or len(answers) != needed:
        return False
    if any(not isinstance(value, str) or not value.strip() or len(value) > 4000
           or chr(0) in value for value in answers):
        return False
    if kind == "write":
        return len(answers[0].split()) >= minimum and len(answers[0]) <= 4000
    if kind in ("mcq", "judge"):
        if len(items) != needed:
            return False
        for item, answer in zip(items, answers):
            options = item.get("opts") if kind == "mcq" else ["To'g'ri", "Noto'g'ri"]
            if not isinstance(options, list) or answer not in options:
                return False
        return True
    if kind == "match":
        options = exercise.get("rights") or []
        return bool(options) and all(answer in options for answer in answers)
    if kind == "bank":
        available = Counter(str(word) for word in exercise.get("bank") or [])
        selected = Counter(answers)
        return bool(available) and all(selected[word] <= available[word] for word in selected)
    if kind == "order":
        if len(items) != needed:
            return False
        return all(Counter(answer.split()) == Counter(word for token in (item.get("words") or [])
                                                   for word in str(token).split())
                   for answer, item in zip(answers, items))
    return kind in ("tr", "transform", "fix", "typed", "fill")


def public_policy() -> dict:
    rules = [
        {"id": "listening", "coins": "1", "uz": "Har bir to‘liq tugallangan mashq — 1 tanga.",
         "en": "Each fully completed exercise — 1 coin."},
        {"id": "reading", "coins": "1", "uz": "Har bir to‘liq tugallangan mashq — 1 tanga.",
         "en": "Each fully completed exercise — 1 coin."},
        {"id": "grammar", "coins": "1", "uz": "Har bir yakunlangan mashq bloki — 1 tanga.",
         "en": "Each completed exercise block — 1 coin."},
        {"id": "writing", "coins": "1", "uz": "Har bir qabul qilingan yakuniy topshiriq — 1 tanga.",
         "en": "Each accepted final submission — 1 coin."},
        {"id": "articles", "coins": "1", "uz": "Barcha savollarga javob berilsa — 1 tanga.",
         "en": "All required article answers — 1 coin."},
        {"id": "ted", "coins": "1 / 5 min", "uz": "Har 5 daqiqa haqiqiy faol ko‘rish — 1 tanga.",
         "en": "Every 5 minutes of verified active watching — 1 coin."},
        {"id": "podcast", "coins": "1 / 5 min", "uz": "Har 5 daqiqa haqiqiy tinglash — 1 tanga.",
         "en": "Every 5 minutes of verified active listening — 1 coin."},
        {"id": "speaking", "coins": "pending", "uz": "Nutq davomiyligi server tomonidan mustaqil tasdiqlanmaguncha tanga berilmaydi.",
         "en": "Speaking coins remain unavailable until the server can independently verify active speech time."},
        {"id": "vocabulary", "coins": "1 / 5", "uz": "Har 5 ta yangi o‘zlashtirilgan so‘z — 1 tanga.",
         "en": "Every 5 newly mastered words — 1 coin."},
        {"id": "assignments", "coins": "per unit",
         "uz": "Mukofot har bir tasdiqlangan mustaqil mashq bo‘yicha. Vazifa yana bonus bermaydi.",
         "en": "Each verified independent exercise counts once. Finishing the assignment does not add another coin."},
    ]
    limits = [
        {"uz": "Tugallanmagan mashq = 0 tanga.", "en": "An unfinished exercise = 0 coins."},
        {"uz": "Avval tugallangan mashqni qaytarish = 0 qo‘shimcha tanga.",
         "en": "Repeating a completed exercise = 0 additional coins."},
        {"uz": "Audio yoki videoni ochish, pauza yoki oxiriga surish = 0 tanga.",
         "en": "Opening media, pausing, or seeking to the end = 0 coins."},
        {"uz": "Bir media uchun kuniga ko‘pi bilan 6 tanga. Media bo‘yicha kunlik chegara 20 tanga.",
         "en": "At most 6 coins per media item per day, and 20 time-based media coins per day."},
        {"uz": "Speaking: bir sessiyada ko‘pi bilan 6, kuniga 12 tanga.",
         "en": "Speaking: at most 6 coins per session and 12 per day."},
        {"uz": "Speak or Die hozir tanga bermaydi: o‘yin ovoz va natijani saqlamaslikni va’da qiladi.",
         "en": "Speak or Die does not award coins yet: the game promises not to store audio or results."},
        {"uz": "Grammar ovozli mashqlari server tasdig‘isiz tanga bermaydi.",
         "en": "Grammar speaking exercises do not award coins without server-verified audio."},
    ]
    return {"version": POLICY_VERSION, "rules": rules, "limits": limits,
            "intro": {"uz": "Learners Area’da mashqlarni haqiqatan tugallash orqali tanga yig‘asiz. Boshlangan, ammo tugallanmagan mashqlar uchun tanga berilmaydi.",
                      "en": "You earn coins by actually finishing exercises. Starting one and leaving it incomplete pays nothing."},
            "example": {"uz": "Agar testda bir nechta mustaqil mashq bo‘lsa, faqat server qabul qilganlari tanga beradi. Yarmini qoldirsangiz — 0, qayta ishlasangiz — 0 qo‘shimcha.",
                        "en": "If a test has several independent exercises, only the ones the server accepts pay. Leaving one half-done pays 0, and repeating it pays nothing more."}}


def practice_label(ms: int) -> str:
    minutes = max(0, int(ms)) // 60000
    hours, mins = divmod(minutes, 60)
    if hours:
        return f"{hours} h {mins} min"
    return f"{mins} min"
