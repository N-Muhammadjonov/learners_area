"""Fail-closed Test 16 transcript-to-dictionary editorial preflight.

No dictionary sense is ever selected by orthography or suffix alone. This
validator accepts a fully explicit editorial plan and verifies transcript
offsets and grammatical choices BEFORE dictionary_context applies its
release/hash/owner safeguards. It does not write to production databases.
"""
import hashlib
import json
import re
from pathlib import Path

TEST = "listening-test-16"
RUNTIME = Path(__file__).resolve().parents[1] / "assets/listening/test-16.json"
WORD = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)?(?:-[A-Za-z]+)*")
UUID = re.compile(r"^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$", re.I)
SHA = re.compile(r"^[0-9a-f]{64}$")


def transcript_parts():
    source = json.loads(RUNTIME.read_text())["files"]["source.html"]
    marker = "const DATA="
    start = source.index(marker) + len(marker)
    data = json.loads(source[start:source.index(";\n", start)])
    assert data["test_id"] == TEST
    return {int(part): text for part, text in data["transcript"].items()}


def preflight(records):
    """Returns True or raises ValueError; never guesses grammatical category.

    Each explicit candidate must carry a dictionary entryId, senseId,
    partOfSpeech and meaningSha checked against the active release separately.
    """
    parts = transcript_parts()
    ordered = {part: [] for part in parts}
    for record in records:
        part = record.get("part")
        if type(part) is not int or part not in parts:
            raise ValueError("part_invalid")
        start, end, surface = record.get("start"), record.get("end"), record.get("surface")
        if type(start) is not int or type(end) is not int or not isinstance(surface, str):
            raise ValueError("span_invalid")
        text = parts[part]
        if start < 0 or end <= start or end > len(text) or text[start:end] != surface:
            raise ValueError("span_mismatch")
        if start and text[start - 1].isalpha() or end < len(text) and text[end].isalpha():
            raise ValueError("partial_word")
        if not all(record.get(x) for x in ("entryId", "senseId", "meaningSha", "partOfSpeech", "lemma")):
            raise ValueError("dictionary_sense_unverified")
        if not UUID.fullmatch(record["entryId"]) or not UUID.fullmatch(record["senseId"]) or not SHA.fullmatch(record["meaningSha"]):
            raise ValueError("dictionary_identity_invalid")
        if record.get("grammaticalUse") not in ("verb", "adjective", "noun", "adverb", "other"):
            raise ValueError("grammatical_use_required")
        if surface.casefold().endswith(("ed", "ing")) and record.get("grammaticalUse") == "adjective" and record["partOfSpeech"] not in ("a", "adjective"):
            raise ValueError("adjective_cannot_be_verb_lemma")
        if record["grammaticalUse"] == "verb" and record["partOfSpeech"] not in ("v", "verb"):
            raise ValueError("verb_requires_verb_sense")
        if record["grammaticalUse"] == "adjective" and record["partOfSpeech"] not in ("a", "adjective"):
            raise ValueError("adjective_requires_adjective_sense")
        if record["grammaticalUse"] == "noun" and record["partOfSpeech"] not in ("n", "noun"):
            raise ValueError("noun_requires_noun_sense")
        if record.get("unitType") == "collocation" and not record.get("lexicographicSource"):
            raise ValueError("collocation_requires_attestation")
        ordered[part].append((start, end))
    for spans in ordered.values():
        spans.sort()
        if any(a[1] > b[0] for a, b in zip(spans, spans[1:])):
            raise ValueError("overlapping_senses")
    return True


# These eight source-created records are complete, non-lexical sentence fragments.
# The source-specific maintenance operation below retains the entire change
# in ONE transaction: a failed sense/hash/offset check rolls back retirement.
# It is NEVER invoked during serving, on import, or by an anonymous request.
LEGACY_PART1 = {
    "353e104e-5ae9-4a1a-b182-c4b1a012044d": (1237,1275,"a couple of miles past the Palace Pier"),
    "935aa2e4-a89a-4cad-b922-c76f2af0252c": (1632,1655,"arrange a meeting place"),
    "5b24a714-fd87-4721-ad3b-a5949e9f535d": (1788,1812,"raise thirty-five pounds"),
    "c90c6be2-ecfd-4a48-aeb1-6554c040f209": (2110,2140,"entered into a free prize draw"),
    "e8437092-d9d4-416b-92a1-a5f24dc7732d": (2534,2557,"a crew of twenty people"),
    "a274bb40-feb1-460f-a79c-e8d3e48b0865": (2911,2930,"parents' permission"),
    "39673a05-6b80-4e3d-8714-ad3981f67f8e": (3102,3121,"wears a life jacket"),
    "174e2a45-6312-4a8f-8b57-94b44bd7d8a8": (3390,3414,"bring some spare clothes"),
}

async def apply_after_reviewing_legacy_part1(con, plan):
    """Explicit maintenance-only atomic replacement, NOT a deployed endpoint.

    Refuse when a previous occurrence, release, source, or sense changed.
    Never auto-link or infer a word's meaning.
    """
    from uuid import UUID
    from app.dictionary_context import apply_context_bindings
    source="dc42157f-0373-462f-9196-a1cc026e2e4c"
    if (not isinstance(plan,dict) or
        plan.get("releaseId")!="rel-v1-1fa06d8d41d8ff701632573e" or
        not any(m.get("source")=="listening" and m.get("sourceId")==source and
                m.get("sectionNumber")==1 and m.get("segmentKey")=="s1"
                for m in plan.get("materials",[]))):
        raise ValueError("test16_plan_not_pinned")
    async with con.transaction():
        await con.execute("SELECT pg_advisory_xact_lock(387384)")
        row=await con.fetchrow("SELECT payload FROM listening_packages WHERE test_id=$1 FOR UPDATE",UUID(source))
        if not row:
            raise ValueError("test16_source_missing")
        payload=row["payload"]
        if isinstance(payload,str):
            payload=json.loads(payload)
        section=next((s for s in payload.get("sections",[]) if s.get("number")==1),None)
        if not section or hashlib.sha256(section["transcript"].encode()).hexdigest()!="700860086d027a47f567269463c7a901a57d46ec6ee0f00c4e1ea65dbba4bfa8":
            raise ValueError("test16_source_changed")
        records=await con.fetch(
            "SELECT id,start_char,end_char,surface_form,lexeme_id,resolution_status FROM lexical_occurrences "
            "WHERE listening_test_id=$1 AND section_number=1 AND segment_key='s1' FOR UPDATE",UUID(source))
        if len(records)!=len(LEGACY_PART1):
            raise ValueError("test16_legacy_inventory_changed")
        for row in records:
            expected=LEGACY_PART1.get(str(row["id"]))
            if (not expected or (row["start_char"],row["end_char"],row["surface_form"])!=expected or
                row["lexeme_id"] is not None or row["resolution_status"]!="unresolved"):
                raise ValueError("test16_legacy_annotation_changed")
        await con.execute(
            "DELETE FROM lexical_occurrences WHERE listening_test_id=$1 "
            "AND section_number=1 AND segment_key='s1' AND id=ANY($2::uuid[])",
            UUID(source),[UUID(key) for key in LEGACY_PART1])
        return await apply_context_bindings(con,plan)


def coverage_report(plan):
    """Count token coverage in transcript order, excluding speaker labels.

    Token counts are not lexical sense counts. Uncovered positions are an
    editorial work queue, not permission to choose the first homograph.
    """
    parts=transcript_parts()
    report={}
    for part,body in sorted(parts.items()):
        source=next((m for m in plan.get("materials",[]) if m.get("sectionNumber")==part and m.get("segmentKey")=="s"+str(part)),None)
        spans=sorted((source or {}).get("spans",[]),key=lambda row:(row["start"],row["end"]))
        for left,right in zip(spans,spans[1:]):
            if left["end"]>right["start"]:
                raise ValueError("overlapping_senses")
        found=[]
        counts={}
        for match in WORD.finditer(body):
            # Speaker labels such as MAN: and WOMAN: are dialogue metadata.
            line=body.rfind("\n",0,match.start())+1
            colon=body.find(":",line)
            if colon>=0 and colon<match.start()+len(match.group()) and body[line:colon].strip().isupper():
                continue
            covered=any(span["start"]<=match.start() and match.end()<=span["end"] for span in spans)
            if not covered:
                word=match.group().casefold()
                counts[word]=counts.get(word,0)+1
                found.append({"start":match.start(),"end":match.end(),"surface":match.group()})
        report[part]={"uncoveredOccurrences":len(found),
            "uncoveredUnique":len(counts),"priorityWords":sorted(counts,key=lambda w:(-counts[w],w)),
            "uncovered":found,"mappedSpans":len(spans)}
    return report
