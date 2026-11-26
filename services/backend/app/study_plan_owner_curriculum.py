"""Band-8 owner curriculum: accuracy-first Grammar, authentic recall and themed input.

Published IELTS descriptors reward controlled range and error-free clauses,
not decorative inversion. Do not modify authored learning materials.
"""
from __future__ import annotations

import re
from dataclasses import replace

from .study_plan_thirty import PlanTask, owner_total_minutes_step

OWNER_FOUNDATION_WRITING = (
    "Articles and countability · write five accurate sentences and a short personal note",
    "Subject–verb agreement · write a 60–80-word explanation and check the verb in each sentence",
    "Sentence boundaries · correct five fragments or run-ons, then write your own examples",
    "Tense control · describe one event in past, present and future forms",
    "Reasons and contrast · express the same idea using because and although",
    "Comparisons and cause–effect · write an 80–100-word explanation",
    "Modals and conditionals · give advice and an example for three everyday situations",
    "Passive and verb patterns · explain a process in 80–100 words and correct three errors",
    "Grammar review · use three phrases from an article or clip in one original paragraph",
)

# Each assessed task starts with a familiar format. The final papers use the
# existing 60-minute Writing exam and require both submitted answers.
OWNER_WRITING_PRACTICE = (
    ("task1", "line-graph", "Identify the main trends and write an overview and two detail paragraphs"),
    ("task1", "line-graph", "Use feedback from Day 10 to correct the overview and check each figure"),
    ("task1", "bar-chart", "Group figures and make meaningful comparisons"),
    ("task1", "table", "Identify the main contrasts and check units and quantities"),
    ("task1", "pie-chart", "Compare the biggest and smallest shares and group similar figures"),
    ("task1", "process", "Give an overview of the process and order the main stages"),
    ("task1", "maps-plans", "Group the changes and describe their locations accurately"),
    ("task1", "mixed-charts", "Write a single overview that relates the two visuals"),
    ("task1", "table", "Write a new report in 20 minutes and revise the weakest paragraph"),
    ("task1", "bar-chart", "Use 20 minutes to check overview, figures, units and tense"),
    ("task2", "opinion", "Plan a clear position, develop two reasons, then write your first essay"),
    ("task2", "opinion", "Apply three corrections from Day 20 to a fresh response"),
    ("task2", "discussion", "Discuss both views, support your reasoning and state your own view"),
    ("task1", "table", "Write 150+ words in 20 minutes and check every figure"),
    ("task2", "problem-solution", "Link each solution to the cause it addresses"),
    ("task2", "multi-part-opinion", "Plan and answer each part of the question"),
    ("task2", "outweigh", "Weigh the main advantage and disadvantage and justify your conclusion"),
    ("task1", "process", "Write a 20-minute report and check the order and voice"),
    ("full", "", "Complete both tasks in 60 minutes and rewrite the two weakest paragraphs"),
    ("task2", "discussion", "Fix your three recurring errors on a fresh question"),
    ("full", "", "Use a fresh paper and save both answers for the final band-readiness review"),
)


def owner_writing_assignments(prompts: list[dict]) -> dict[int, tuple[str, str, str]]:
    assignments = {}
    used = set()
    by_type = {"task1": [], "task2": []}
    for prompt in prompts:
        task_type = re.sub(r"[\s_-]", "", str(prompt.get("task_type", "")).lower())
        if task_type in by_type:
            by_type[task_type].append(prompt)
    for day, focus in enumerate(OWNER_FOUNDATION_WRITING, 1):
        seconds = 30 if day == 1 else 60 if day < 5 else 120 if day < 8 else 180
        assignments[day] = (
            f"Writing foundation · {focus} · Typing {seconds}s",
            f"/app/writing?tab=typing&preset={seconds}", f"typing:{seconds}",
        )
    for day, (task_type, category, focus) in enumerate(OWNER_WRITING_PRACTICE, 10):
        if task_type == "full":
            if all(by_type.values()):
                assignments[day] = (f"Full Writing · Task 1 + Task 2 · {focus}",
                                    "/app/writing?tab=exam", "writing-full")
            else:
                assignments[day] = ("Writing preparation · review your error log and practise typing",
                                    "/app/writing?tab=typing&preset=180", "typing:180")
            continue
        matching = by_type[task_type]
        fresh = [item for item in matching if item["source_key"] not in used]
        candidates = fresh or matching
        prompt = next((item for item in candidates if item.get("category") == category),
                      candidates[0] if candidates else None)
        label, minimum = ("Academic Task 1", 150) if task_type == "task1" else ("Task 2", 250)
        if prompt:
            used.add(prompt["source_key"])
            # Use the source category to avoid describing a different prompt format as the planned one.
            if prompt.get("category") != category:
                focus = "Analyse the prompt, write independently and revise the weakest paragraph"
            assignments[day] = (f"{label} · {prompt['title'].removeprefix('Writing — ')} · {focus} · {minimum}+ words",
                                prompt["href"], prompt["source_key"])
        else:
            assignments[day] = (f"{label} preparation · {focus} · Typing 180s",
                                "/app/writing?tab=typing&preset=180", "typing:180")
    return assignments


def owner_speaking_part(day: int) -> str:
    if day < 7:
        return "part1"
    if day < 16:
        return "part2"
    return "part2" if day % 3 == 2 else "part3"


def owner_listening_mcq_ordinal(day: int) -> int | None:
    # Early intensive days also practise a single question type. Afterwards
    # alternate that work with full papers, keeping MCQ source numbers stable.
    if day <= 9:
        return day
    return (day + 9) // 2 if day % 2 else None

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
