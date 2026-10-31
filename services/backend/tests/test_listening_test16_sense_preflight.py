import importlib.util
from pathlib import Path
import pytest

MODULE=Path(__file__).resolve().parents[1]/"tools/listening_test16_sense_preflight.py"
spec=importlib.util.spec_from_file_location("test16_preflight", MODULE)
tool=importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)

def record(surface, part=1):
    text=tool.transcript_parts()[part]
    start=text.index(surface)
    return dict(part=part,start=start,end=start+len(surface),surface=surface,
        entryId="11111111-1111-4111-8111-111111111111",
        senseId="22222222-2222-4222-8222-222222222222",
        meaningSha="a"*64,lemma="develop",partOfSpeech="v",
        grammaticalUse="verb",unitType="word")

def test_four_parts_present():
    assert set(tool.transcript_parts())=={1,2,3,4}

def test_exact_verb_form_can_be_explicitly_selected():
    assert tool.preflight([record("joining")])

def test_adjective_must_not_be_linked_to_verb_sense():
    candidate=record("interested")
    candidate.update(grammaticalUse="adjective")
    with pytest.raises(ValueError,match="adjective_cannot_be_verb_lemma"):
        tool.preflight([candidate])

def test_collocations_require_source_not_fabrication():
    candidate=record("take part")
    candidate["unitType"]="collocation"
    with pytest.raises(ValueError,match="attestation"):
        tool.preflight([candidate])

def test_undocumented_sense_is_rejected():
    candidate=record("joining")
    candidate.pop("senseId")
    with pytest.raises(ValueError,match="unverified"):
        tool.preflight([candidate])

def test_wrong_offsets_rejected():
    candidate=record("joining")
    candidate["start"]+=1
    with pytest.raises(ValueError,match="span_mismatch"):
        tool.preflight([candidate])

def test_pinned_plan_has_exact_transcript_offsets_and_well_formed_sense_ids():
    import json
    path=Path(__file__).resolve().parents[3]/"audits/listening/test-16-verified-binding-plan.json"
    plan=json.loads(path.read_text())
    assert plan["version"]==1 and plan["releaseId"].startswith("rel-v1-")
    records=[]
    for material in plan["materials"]:
        for span in material["spans"]:
            # POS and actual release hash MUST be validated separately against
            # R2; this unit test does not fake that by calling every term a noun.
            records.append({**span,"part":material["sectionNumber"],
                "lemma":"__release_check_required__","partOfSpeech":"other",
                "grammaticalUse":"other","unitType":"word"})
    assert tool.preflight(records)

def test_adjective_grammar_does_not_accept_verb_mapping_even_without_ed():
    candidate=record("joining")
    candidate.update(grammaticalUse="adjective")
    with pytest.raises(ValueError,match="adjective"):
        tool.preflight([candidate])

def test_ill_formed_ids_or_digest_are_refused():
    for key,value in [("senseId","bad"),("entryId","bad"),("meaningSha","123")]:
        candidate=record("joining")
        candidate[key]=value
        with pytest.raises(ValueError,match="dictionary_identity_invalid"):
            tool.preflight([candidate])

def test_all_pinned_transcript_offsets_nonoverlapping():
    import json
    plan=json.loads((Path(__file__).resolve().parents[3]/"audits/listening/test-16-verified-binding-plan.json").read_text())
    parts=tool.transcript_parts()
    for material in plan["materials"]:
        text=parts[material["sectionNumber"]]
        spans=material["spans"]
        assert spans==sorted(spans,key=lambda x:x["start"])
        assert all(text[x["start"]:x["end"]]==x["surface"] for x in spans)
        assert all(a["end"]<=b["start"] for a,b in zip(spans,spans[1:]))
    assert len(next(m for m in plan["materials"] if m["sectionNumber"]==1)["spans"])>=100

def test_no_fake_sentence_as_standalone_lexical_entry_in_part_one():
    import json
    plan=json.loads((Path(__file__).resolve().parents[3]/"audits/listening/test-16-verified-binding-plan.json").read_text())
    spans=next(m["spans"] for m in plan["materials"] if m["sectionNumber"]==1)
    assert all(len(span["surface"].split())<=2 for span in spans)
    assert all(span["surface"].strip()==span["surface"] for span in spans)

def test_auxiliary_inflections_open_v1_lemma_not_fabricated_forms():
    from app.step30_video_lexical import forms_of
    forms=lambda lemma,pos: {f[1] for f in forms_of(lemma,pos)}
    be=forms("be","auxiliary verb")
    have=forms("have","auxiliary verb")
    do=forms("do","auxiliary verb")
    assert {"be","am","is","are","was","were","being","been"} <= be
    assert {"have","has","had","having"} <= have
    assert {"do","does","did","done","doing"} <= do
    assert "bes" not in be and "haves" not in have
    assert forms("can","modal verb")=={"can"}

def test_inflection_does_not_make_adjectives_verbs():
    from app.step30_video_lexical import forms_of
    result={form[1] for form in forms_of("interested","adjective")}
    assert "interested" in result
    assert "interesting" not in result

def test_part_one_dictionary_drafts_have_real_headwords_and_uzbek_examples():
    import json
    drafts=json.loads((Path(__file__).resolve().parents[3]/
      "audits/listening/test-16-part1-dictionary-drafts.json").read_text())
    assert drafts["status"]=="editorial_drafts_not_published"
    assert len(drafts["drafts"])>=30
    new_entries={}
    for d in drafts["drafts"]:
        assert d["definitionEn"] and d["definitionUz"] and d["translationUz"]
        assert d["examples"] and all(e.get("textEn") and e.get("textUz") for e in d["examples"])
        if d["operation"]=="add_lexeme":
            assert len(d["lemma"].split())<=3
            assert all(ch not in d["lemma"] for ch in ".!?")
            key=(d["lemma"].casefold(),d["partOfSpeech"],d["lexicalType"])
            assert key not in new_entries
            new_entries[key]=d
        else:
            assert d["operation"]=="add_sense" and d["lexemeId"]

def test_derivative_dictionary_entry_ids_are_stable_and_unique():
    import hashlib,json
    drafts=json.loads((Path(__file__).resolve().parents[3]/
      "audits/listening/test-16-part1-dictionary-drafts.json").read_text())
    for lemma,expected in drafts["derivedEntryIds"].items():
        found=next(d for d in drafts["drafts"] if d.get("lemma")==lemma and d["operation"]=="add_lexeme")
        key="|".join((lemma,found["partOfSpeech"],found["lexicalType"]))
        h=bytearray(hashlib.sha256(("learners-area-dictionary-v1:lexeme:"+key).encode()).digest()[:16])
        h[6]=(h[6]&15)|80
        h[8]=(h[8]&63)|128
        raw=h.hex()
        actual="-".join((raw[:8],raw[8:12],raw[12:16],raw[16:20],raw[20:]))
        assert actual==expected

def test_staged_part_one_queue_matches_every_unbound_token_exactly():
    import json
    root=Path(__file__).resolve().parents[3]/"audits/listening"
    plan=json.loads((root/"test-16-verified-binding-plan.json").read_text())
    staged=json.loads((root/"test-16-part1-staged-remaining-bindings.json").read_text())
    body=tool.transcript_parts()[1]
    part=next(m for m in plan["materials"] if m["sectionNumber"]==1)
    report=tool.coverage_report(plan)[1]
    assert staged["status"]=="fully_enumerated_NOT_PUBLISHED_NOT_BOUND"
    assert staged["sourceRelease"]==plan["releaseId"]
    assert staged["inputOccurrences"]==len(staged["records"])
    assert len(staged["records"])==report["uncoveredOccurrences"]
    assert [(s["start"],s["end"],s["surface"]) for s in staged["records"]]==[
        (s["start"],s["end"],s["surface"]) for s in report["uncovered"]]
    for s in staged["records"]:
        assert body[s["start"]:s["end"]]==s["surface"]
        assert s["lexicalTarget"] and s["resolution"]=="staged_pending_release_and_context_review"
        assert not any(x["start"]<=s["start"]<x["end"] for x in part["spans"])


def test_draft_dependencies_and_new_lexeme_keys_are_unique():
    import json
    root=Path(__file__).resolve().parents[3]/"audits/listening"
    data=json.loads((root/"test-16-part1-dictionary-drafts.json").read_text())
    keys=set()
    for draft in data["drafts"]:
        if draft["operation"]=="add_lexeme":
            key=(draft["lemma"].casefold(),draft["partOfSpeech"],draft["lexicalType"])
            assert key not in keys, f"duplicate new entry: {key}"
            keys.add(key)
        else:
            assert draft["operation"]=="add_sense"
            assert draft["lexemeId"] and draft["lexemeId"]!="null"
    assert ("semifinal","n","word") not in keys
    assert ("a.m.","r","word") not in keys
