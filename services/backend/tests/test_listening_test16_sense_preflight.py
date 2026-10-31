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

def test_real_release_binding_plan_is_exactly_grounded():
    import json
    path=Path(__file__).resolve().parents[3]/"audits/listening/test-16-verified-binding-plan.json"
    plan=json.loads(path.read_text())
    assert plan["version"]==1 and plan["releaseId"].startswith("rel-v1-")
    records=[]
    for material in plan["materials"]:
        for span in material["spans"]:
            records.append({**span,"part":material["sectionNumber"],
                "lemma":"ethnography","partOfSpeech":"n","grammaticalUse":"noun",
                "unitType":"word"})
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
