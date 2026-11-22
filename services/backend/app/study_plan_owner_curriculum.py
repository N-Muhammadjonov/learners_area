"""Band-8 owner curriculum: accuracy-first Grammar, authentic recall and themed input.

Published IELTS descriptors reward controlled range and error-free clauses,
not decorative inversion. Do not modify authored learning materials.
"""
from __future__ import annotations

from dataclasses import replace
from datetime import date

from .study_plan_thirty import PlanTask, owner_total_minutes

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
OWNER_MEDIA_DAYS: dict[int, tuple[str, str, str]] = {
    3: ("article", "advertising", "Identify assertion, concession and fragment-free examples"),
    5: ("video", "iG9CE55wbtY", "Recast three broad claims as precise academic propositions"),
    7: ("article", "air-pollution", "Paraphrase causes and effects with varied sentence forms"),
    10: ("video", "RKK7wGAYP6k", "Explain a hypothesis using accurate conditionals"),
    12: ("article", "remote-work-wars", "Extract balanced claims and nominalise causes"),
    14: ("video", "qp0HIF3SfI4", "Separate evidence from opinion and hedge conclusions"),
    17: ("article", "unemployment", "Construct nuanced claims about conditional outcomes"),
    19: ("video", "D9Ihs241zeg", "Report a speaker's argument accurately and attribute ideas"),
    21: ("article", "artificial-intelligence", "Qualify uncertain future predictions"),
    24: ("video", "_6xlNyWPpB8", "Summarise processes using accurate passive clauses"),
    26: ("article", "sleep-wellbeing", "Compare evidence, limitations and alternative views"),
    28: ("video", "n3kNlFMXslo", "Contrast time-management approaches without overclaiming"),
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
    """Assign authored media in order only to actual Tue/Thu/Sat intensive dates.

    Study days can be rebased or future dates shifted without placing TED
    on a learner's in-person course day or Sunday full-mock block.
    """
    heavy_days = [day["day"] for day in days
                  if date.fromisoformat(day["date"]).weekday() in (1, 3, 5)]
    return dict(zip(heavy_days, OWNER_MEDIA_DAYS.values()))


SRS_DELAYS: tuple[int, ...] = (1, 3, 7, 16)
RETENTION_LEVEL_CHANGE_DAY = 21
RETENTION_MINUTES = {"course": 12, "intensive": 15, "sunday": 20}
MEDIA_MINUTES = 20


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
        on = date.fromisoformat(day["date"])
        course = on.weekday() in (0, 2, 4)
        sunday = on.weekday() == 6
        mode = "course" if course else "sunday" if sunday else "intensive"
        tasks = list(day["tasks"])
        minutes = RETENTION_MINUTES[mode]
        # Retention replaces part of existing receptive-skill practice;
        # total independent study time remains exactly the user's weekly chart.
        read_cut = 5 if course else 10 if sunday else 7
        listen_cut = minutes - read_cut
        tasks[1] = replace(tasks[1], minutes=tasks[1].minutes - read_cut)
        tasks[2] = replace(tasks[2], minutes=tasks[2].minutes - listen_cut)
        retention_level = "C1" if number >= RETENTION_LEVEL_CHANGE_DAY else "B2"
        tasks.append(PlanTask(
            number, 6, "retention",
            f"Retention {retention_level} — read 2 min, blind recall 3 min, correct omissions",
            "/app/reading/retention?level=" + retention_level,
            "retention:" + retention_level, minutes,
        ))
        media = media_assignments.get(number)
        if media:
            kind, key, objective = media
            if kind == "article":
                if key not in ARTICLES:
                    raise ValueError("unknown_owner_article")
                tasks[1] = replace(tasks[1], minutes=tasks[1].minutes - MEDIA_MINUTES)
                tasks.append(PlanTask(
                    number, 7, "article",
                    f"Article — {ARTICLES[key]} · {objective}; complete all questions"[:350],
                    "/app/reading/articles/" + key, "article:" + key, MEDIA_MINUTES,
                ))
            elif video := videos.get(key):
                tasks[2] = replace(tasks[2], minutes=tasks[2].minutes - MEDIA_MINUTES)
                tasks.append(PlanTask(
                    number, 7, "video",
                    f"TED — {video['title']} · {objective}; shadow and summarise"[:350],
                    "/app/video-lessons/" + video["id"],
                    "video:" + video["id"], MEDIA_MINUTES,
                ))
            # If a video is unpublished, do not claim an unusable lesson or
            # silently remove minutes from the original listening assignment.
        if any(task.minutes <= 0 or task.minutes > 90 for task in tasks):
            raise ValueError("invalid_owner_slot_minutes")
        if sum(task.minutes for task in tasks) != owner_total_minutes(on):
            raise ValueError("invalid_owner_daily_total")
        result.append({**day, "tasks": tasks})
    return result
