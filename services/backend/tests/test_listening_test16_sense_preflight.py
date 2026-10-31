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
