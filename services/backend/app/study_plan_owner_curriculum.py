"""Band-8 owner curriculum: accuracy-first Grammar, authentic recall and themed input.

Published IELTS descriptors reward controlled range and error-free clauses,
not decorative inversion. Do not modify authored learning materials.
"""
from __future__ import annotations

from dataclasses import replace
from datetime import date

from .study_plan_thirty import PlanTask, owner_total_minutes_step

# B2 fundamentals -> functional complex grammar -> C1 precision and transfer.
# Every ID is an existing published Grammar unit with server-graded exercises.
OWNER_GRAMMAR_SEQUENCE: tuple[tuple[str, str], ...] = (
    ("b2-9", "Articles and countability: stop recurring noun-phrase errors"),
    ("wr-083", "Subject-verb agreement inside long academic sentences"),
    ("wr-086", "Eliminate fragments, comma splices and run-on sentences"),
    ("b2-13", "Punctuation: boundaries, commas and apostrophes"),
    ("wr-082", "Generic and specific noun phrases in Task 2"),
    ("b2-1", "Tense and aspect accuracy in examples and narratives"),
    ("wr-085", "Control varied simple, compound and complex sentences"),
    ("wr-064", "Relative clauses without reference ambiguity"),
    ("b2-6", "Reduced relatives and participial modifiers"),
    ("wr-063", "Real and hypothetical conditionals with clear meaning"),
    ("wr-058", "Accurate concession instead of mechanical linking"),
    ("b2-10", "Parallelism and academic nominalisation"),
    ("wr-067", "Nominalisation without awkward noun stacks"),
    ("wr-062", "Hedging: avoid unsupported absolute claims"),
    ("spk-58", "Natural comparative and hypothetical spoken choices"),
    ("spk-66", "Spoken second conditional without tense errors"),
    ("spk-73", "Whether/if clauses in nuanced spoken answers"),
    ("wr-060", "Cause-effect syntax and preposition control"),
    ("wr-066", "Impersonal passive with accurate agents and tense"),
    ("wr-070", "Noun clauses in arguments and reporting"),
    ("c1-8", "C1 reporting, attribution and calibrated uncertainty"),
    ("wr-120", "Nominalised cause-effect with unambiguous subjects"),
    ("c1-5", "Participle clauses with correct logical subjects"),
    ("wr-112", "Formal impersonal reporting passive"),
    ("wr-117", "Formal relative clauses and accurate prepositions"),
    ("spk-47", "Taking evidence into account while speaking"),
    ("spk-45", "Given that: state justified reasons succinctly"),
    ("c1-7", "Advanced concession and nuanced comparisons"),
    ("c1-11", "Commas, parentheticals and information flow"),
    ("c1-2", "Clefts and focus for precise emphasis"),
)

# Existing in-product reading articles and published TED/YouTube lesson videos.
# Supplements are concentrated on intensive, non-course days.
# Published YouTube lessons, ordered to match the 30-step owner progression.
# The source pool verifies publication before any task is assigned.
OWNER_VIDEO_ORDER: tuple[str, ...] = (
    "iG9CE55wbtY",
    "hJP5GqnTrNo",
    "_6xlNyWPpB8",
    "RcGyVTAoXEU",
    "5XD2kNopsUs",
    "lEXBxijQREo",
    "t7Xr3AsBEK4",
    "D9Ihs241zeg",
    "qp0HIF3SfI4",
    "IFjD3NMv6Kw",
    "R7vmHGAshi8",
    "ubEadhXWwV4",
    "hmFQqjMF_f0",
    "L8YJtvHGeUU",
    "8KkKuTCFvzI",
    "R0JKCYZ8hng",
    "RKK7wGAYP6k",
    "PsihkFWDt3Y",
    "hiIcwt88o94",
    "BiSYoeqb_VY",
    "6ibCtsHgz3Y",
    "dqONk48l5vY",
    "n3kNlFMXslo",
    "arj7oStGLkU",
    "vhhgI4tSMwc",
)
OWNER_MEDIA_DAYS: dict[int, tuple[str, str, str]] = {
    **{day: ("video", video_id, "Extract 3-5 natural collocations, shadow and use one in output")
       for day, video_id in enumerate(OWNER_VIDEO_ORDER, 1)},
    26: ("article", "advertising", "Distinguish claims from examples and rewrite one paragraph"),
    27: ("article", "unemployment", "Practise balanced causal claims and topic sentences"),
    28: ("article", "air-pollution", "Contrast viewpoints and identify evidence"),
    29: ("article", "sleep-wellbeing", "Review nuanced academic collocations"),
    30: ("article", "artificial-intelligence", "Summarise evidence and reassess uncertain claims"),
}

ARTICLES: dict[str, str] = {
    "advertising": "Advertising: how it influences children and teenagers",
    "air-pollution": "Air Pollution - Preventive Measures, Causes and Types",
    "remote-work-wars": "Remote Work Wars",
    "unemployment": "The consequences of unemployment",
    "artificial-intelligence": "Advantages and Disadvantages of Artificial Intelligence",
    "sleep-wellbeing": "Sleep and wellbeing",
}

def owner_media_assignments(days: list[dict]) -> dict[int, tuple[str, str, str]]:
    """Assign media by logical learning step; a missed day never changes inputs."""
    return {day["day"]: OWNER_MEDIA_DAYS[day["day"]] for day in days
            if day["day"] in OWNER_MEDIA_DAYS}


SRS_DELAYS: tuple[int, ...] = (1, 3, 7, 16)
RETENTION_MINUTES = 15
MEDIA_MINUTES = 20


def owner_retention_target(day: int) -> tuple[str, str, str]:
    level = 'A2' if day <= 10 else 'B1' if day <= 20 else 'B2'
    return (
        f'Retention {level} — read 2 min, recall in writing for 5 min, review missed ideas',
        f'/app/reading/retention?level={level}',
        f'retention:{level}',
    )


def select_owner_grammar(level: str, day: int, catalog: list[dict]) -> tuple[dict, str] | None:
    """Use source-authored B2/C1 material; never invent exam content."""
    if level != "B2" or day < 1 or day > len(OWNER_GRAMMAR_SEQUENCE):
        return None
    unit_id, focus = OWNER_GRAMMAR_SEQUENCE[day - 1]
    unit = next((candidate for candidate in catalog
                 if candidate.get("id") == unit_id and candidate.get("level") in ("B2", "C1")), None)
    if not unit:
        raise ValueError(f"owner_grammar_missing:{unit_id}")
    return unit, focus


async def load_owner_video_pool(con) -> dict[str, dict]:
    """Only published, active, in-site standalone videos can enter a plan."""
    keys = [source for kind, source, _ in OWNER_MEDIA_DAYS.values() if kind == "video"]
    rows = await con.fetch("""SELECT id,video_id,title FROM video_lessons
        WHERE video_id=ANY($1::text[]) AND lesson_id IS NULL AND is_active
          AND provider='youtube' AND media_kind='video'
          AND (publication_state='published' OR
               (publication_state='scheduled' AND publish_at<=NOW()))""", keys)
    return {row["video_id"]: {"id": str(row["id"]), "title": row["title"]}
            for row in rows}


def enrich_owner_plan(days: list[dict], videos: dict[str, dict],
                      *, level: str, after_day: int = 0) -> list[dict]:
    """Embed genuine Retention and selected Article/TED tasks within daily budgets.

    The first six established task slots keep their source keys and evidence.
    Vocabulary SRS is still performed in its Vocabulary slot; the new Retention
    slot is a distinct timed comprehension-and-recall exercise.
    """
    if level != "B2":
        return days
    result = []
    media_assignments = owner_media_assignments(days)
    for day in days:
        number = day["day"]
        if number <= after_day:
            result.append(day)
            continue
        if len(day["tasks"]) != 6:
            raise ValueError("invalid_owner_base_tasks")
        tasks = list(day["tasks"])
        minutes = RETENTION_MINUTES
        # Retention replaces part of existing receptive-skill practice;
        # total independent study time remains exactly the user's weekly chart.
        read_cut = 5
        listen_cut = minutes - read_cut
        tasks[1] = replace(tasks[1], minutes=tasks[1].minutes - read_cut)
        tasks[2] = replace(tasks[2], minutes=tasks[2].minutes - listen_cut)
        title, href, source_key = owner_retention_target(number)
        tasks.append(PlanTask(number, 6, 'retention', title, href, source_key, minutes))
        media = media_assignments.get(number)
        if media:
            kind, key, objective = media
            if kind == "article":
                if key not in ARTICLES:
                    raise ValueError("unknown_owner_article")
                # Preserve enough time for a 60-minute full Academic Reading
                # assessment. Use part of the extended Vocabulary allowance.
                tasks[5] = replace(tasks[5], minutes=tasks[5].minutes - MEDIA_MINUTES)
                tasks.append(PlanTask(
                    number, 7, "article",
                    f"Article — {ARTICLES[key]} · {objective}; complete all questions"[:350],
                    "/app/reading/articles/" + key, "article:" + key, MEDIA_MINUTES,
                ))
            elif video := videos.get(key):
                # Listening is itself a full 40-question timed paper; keep
                # sufficient minutes for the recording and transcript review.
                tasks[5] = replace(tasks[5], minutes=tasks[5].minutes - MEDIA_MINUTES)
                tasks.append(PlanTask(
                    number, 7, "video",
                    f"TED — {video['title']} · {objective}; shadow and summarise"[:350],
                    "/app/video-lessons/" + video["id"],
                    "video:" + video["id"], MEDIA_MINUTES,
                ))
            else:
                # A missing or unpublished video is replaced by a verified
                # in-site article rather than becoming a dead, locked step.
                article_key = "advertising"
                tasks[5] = replace(tasks[5], minutes=tasks[5].minutes - MEDIA_MINUTES)
                tasks.append(PlanTask(
                    number, 7, "article",
                    f"Article — {ARTICLES[article_key]} · Extract evidence and reformulate claims",
                    "/app/reading/articles/" + article_key,
                    "article:" + article_key, MEDIA_MINUTES,
                ))
        if any(task.minutes <= 0 or task.minutes > 90 for task in tasks):
            raise ValueError("invalid_owner_slot_minutes")
        if sum(task.minutes for task in tasks) != owner_total_minutes_step(number):
            raise ValueError("invalid_owner_daily_total")
        result.append({**day, "tasks": tasks})
    return result
