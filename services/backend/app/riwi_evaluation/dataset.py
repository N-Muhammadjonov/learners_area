"""Original practice and engineering datasets, partitioned before expansion.

These examples are synthetic. Objective references follow the written facts
or answer alternatives. Writing/Speaking exercises have no invented band labels.
Shared question templates mean this is not an independent language benchmark.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json

SPLITS = ("training", "calibration", "validation", "final_holdout")

# Split assignment belongs to the semantic source family, never the individual
# answer variant. Alternatives and wrong-answer variants cannot cross splits.
FAMILIES = (
    ("library", "The library closes at six on Fridays.", "When does the library close on Fridays?", "six", "nine"),
    ("bicycle", "A bicycle repair course lasts three weeks.", "How many weeks does the repair course last?", "three", "seven"),
    ("orchard", "The orchard grows pears near the river.", "What fruit grows near the river?", "pears", "plums"),
    ("museum", "Visitors enter the museum through the eastern door.", "Which door do museum visitors use?", "eastern", "western"),
    ("bakery", "The bakery delivers bread on Tuesdays.", "On which day does the bakery deliver bread?", "Tuesdays", "Mondays"),
    ("garden", "The school garden needs watering every morning.", "When does the school garden need watering?", "every morning", "each evening"),
    ("bridge", "The footbridge was built using recycled steel.", "Which material was used for the footbridge?", "recycled steel", "fresh timber"),
    ("solar", "Solar panels supply electricity to the village clinic.", "What do the panels supply to the clinic?", "electricity", "water"),
    ("railway", "The coastal railway opened in April.", "In which month did the coastal railway open?", "April", "August"),
    ("textiles", "Workers dry the dyed cloth in shaded rooms.", "Where do workers dry the dyed cloth?", "shaded rooms", "sunny fields"),
    ("wetland", "A protected wetland provides shelter for migrating birds.", "Which animals use the wetland for shelter?", "migrating birds", "farm horses"),
    ("pottery", "The pottery workshop offers evening classes.", "When are classes offered at the pottery workshop?", "evening", "morning"),
    ("glass", "The laboratory cools molten glass slowly.", "How does the laboratory cool molten glass?", "slowly", "rapidly"),
    ("forest", "Forest rangers record rainfall each month.", "What do the forest rangers record?", "rainfall", "traffic"),
    ("harbour", "Fishing boats unload their catch at the northern quay.", "At which quay do fishing boats unload?", "northern", "southern"),
    ("archive", "The town archive stores maps in flat drawers.", "Where does the archive store maps?", "flat drawers", "open boxes"),
    ("theatre", "The theatre rehearsals begin after lunch.", "When do the theatre rehearsals begin?", "after lunch", "before breakfast"),
    ("recycling", "The recycling centre accepts clean cardboard.", "What material does the recycling centre accept?", "clean cardboard", "oily plastic"),
    ("astronomy", "The observatory opens to visitors on Saturdays.", "On which day can visitors enter the observatory?", "Saturdays", "Thursdays"),
    ("canal", "The canal lock is operated by hand.", "How is the canal lock operated?", "by hand", "by computer"),
    ("terrace", "Terrace farmers collect rainwater in stone tanks.", "Where do terrace farmers collect rainwater?", "stone tanks", "wooden barrels"),
    ("shelter", "The animal shelter needs volunteers during winter.", "During which season are volunteers needed?", "winter", "summer"),
    ("aquarium", "The aquarium feeds its rays at noon.", "When does the aquarium feed its rays?", "noon", "midnight"),
    ("weaving", "The weaving cooperative uses locally grown cotton.", "What material does the cooperative use?", "locally grown cotton", "imported wool"),
)


@dataclass(frozen=True)
class Case:
    case_id: str
    split: str
    family: str
    domain: str
    prompt: str
    response: str
    accepted_answers: tuple[str, ...]
    expected_correct: bool | None
    label_provenance: str
    content_sha256: str


def _case(split, family, domain, prompt, response, accepted=(), expected=None):
    digest = hashlib.sha256(json.dumps([domain, prompt, response], ensure_ascii=False).encode()).hexdigest()
    return Case(digest[:20], split, family, domain, prompt, response, accepted, expected,
                "synthetic_answer_key" if expected is not None else "unlabelled_practice_exercise", digest)


def generate_cases() -> list[Case]:
    cases = []
    for index, (family, fact, question, answer, wrong) in enumerate(FAMILIES):
        split = SPLITS[index // 6]
        for domain in ("reading", "listening"):
            prompt = f"{'Passage' if domain == 'reading' else 'Listening script'}: {fact}\nQuestion: {question}"
            for response, expected in ((answer, True), (answer.upper(), True), (wrong, False), ("", False)):
                cases.append(_case(split, family, domain, prompt, response, (answer,), expected))
        # Correction exercises have explicit accepted reference sentences. They
        # assess this item, not a general learner's grammar competence.
        prompt = f"Rewrite with standard capitalization and terminal punctuation: '{fact.lower().rstrip('.')}'"
        cases.append(_case(split, family, "grammar", prompt, fact, (fact,), True))
        cases.append(_case(split, family, "grammar", prompt, wrong, (fact,), False))
        vocab_prompt = f"In '{fact}', which phrase answers '{question}'?"
        cases.append(_case(split, family, "vocabulary", vocab_prompt, answer, (answer,), True))
        cases.append(_case(split, family, "vocabulary", vocab_prompt, wrong, (answer,), False))
        cases.append(_case(split, family, "writing", f"{fact} Discuss how this service or activity could benefit a community. Give reasons and examples.", ""))
        cases.append(_case(split, family, "speaking", f"Describe a place or activity connected with {family}. Explain why it matters to you.", ""))
    return cases


def validate_splits(cases: list[Case]) -> dict:
    if not cases or {c.split for c in cases} != set(SPLITS):
        raise ValueError("incomplete_dataset_splits")
    families, hashes, ids = {}, {}, set()
    counts = {split: 0 for split in SPLITS}
    domains: dict[str, int] = {}
    for case in cases:
        expected_hash = hashlib.sha256(json.dumps([case.domain, case.prompt, case.response], ensure_ascii=False).encode()).hexdigest()
        if case.content_sha256 != expected_hash or case.case_id != expected_hash[:20]:
            raise ValueError("case_content_hash_mismatch")
        if case.case_id in ids:
            raise ValueError("duplicate_case_id")
        ids.add(case.case_id)
        if families.setdefault(case.family, case.split) != case.split:
            raise ValueError("cross_split_source_family")
        if hashes.setdefault(case.content_sha256, case.split) != case.split:
            raise ValueError("cross_split_content_duplicate")
        if case.label_provenance == "unlabelled_practice_exercise" and case.expected_correct is not None:
            raise ValueError("invented_subjective_label")
        counts[case.split] += 1
        domains[case.domain] = domains.get(case.domain, 0) + 1
    return {"total_cases": len(cases), "unique_source_families": len(families), "split_counts": counts,
            "domain_counts": domains, "cross_split_source_families": 0, "cross_split_exact_duplicates": 0,
            "subjective_band_labels": 0,
            "independent_language_benchmark": False,
            "limitation": "Question templates are shared. Family separation alone does not establish semantic or statistical independence."}


def export_jsonl(cases: list[Case]) -> str:
    validate_splits(cases)
    return "".join(json.dumps(asdict(case), ensure_ascii=False, sort_keys=True) + "\n" for case in cases)
