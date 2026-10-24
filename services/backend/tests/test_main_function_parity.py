"""Outputs captured by executing actual main functions, not rewritten reference rules."""
import json
from pathlib import Path
from datetime import datetime
import pytest
from app import main
from app.step32_grammar_practice import check_structures, structure_verdict
from app.step30_video_lexical import forms_of
from app.step21_vocab_batch import sense_key,legacy_sense_key
from app.step21_reading_port import matches, correct
from app.step19_vocab_srs_port import advance, iso
from app.step35_retention_scoring import evaluate_recall
from app.step32_writing_riwi import wval
from app.step31_riwi_evaluators import sval
from app.auth_validation import validate as validate_auth
from app.admin_validation import parse as validate_admin
from app.dictionary_presentation import present
from app.dictionary_context import matches_context_form
from app.editorial_revisions import revise_dictionary_translations
from app.step40_content_drafts import resolve_listening_type

FIXTURES = json.loads(Path(__file__).with_name('main-function-fixtures.json').read_text())


@pytest.mark.parametrize('case', FIXTURES['cases'], ids=lambda c:c['id'])
def test_main_function_output(case):
    kind = case['kind'];data = case['input']
    if kind == 'structures':
        actual = check_structures(data['answer'], data['structures'])
        actual = {**actual, 'verdict': structure_verdict(actual, bool(data['structures']))}
    elif kind == 'forms':
        actual = [{'form': value, 'formNorm': norm, 'formType': mode} for value,norm,mode in forms_of(data['term'],data['pos'])]
    elif kind == 'reading':
        actual = any(matches(data['answer'], key) for key in [data['key'], *data['accepted']])
    elif kind == 'reading_question':
        q = data['q']
        actual = correct({'type':q['type'], 'type_code':q.get('typeCode'), 'correct_answer':q['correctAnswer'], 'accepted_answers':q['acceptedAnswers'], 'options':q['options'], 'answer_constraint':q['answerConstraint']}, data['answer'])
    elif kind == 'srs':
        entry = data['entry'];now = datetime.fromisoformat(data['now'].replace('Z','+00:00'))
        actual = advance({'srs_stage':entry['srsStage'],'correct_count':entry['correctCount'],'incorrect_count':entry['incorrectCount'],'active_use_count':entry['activeUseCount']},data['outcome'],now)
        actual['nextReviewAt'] = iso(actual['nextReviewAt']);actual['lastReviewedAt'] = iso(now)
    elif kind == 'retention':
        score,breakdown = evaluate_recall(data['text'],data['structure']);actual = {'score':score,'breakdown':breakdown}
    elif kind == 'writing':
        actual = wval(data['taskType'],data['prompt'],data['content'],data['targetWordCount'])
    elif kind == 'sense_identity':
        item={'term':data['term'],'partOfSpeech':data['partOfSpeech'],'definitionEn':data['meaning']}
        actual={'key':sense_key(item),'legacy':legacy_sense_key(item)}
    elif kind == 'auth_validation':
        value,error=validate_auth(data['body'],data['mode']);actual={'value':value,'error':error}
    elif kind == 'admin_validation':
        value,error=validate_admin(data['body'],data['mode']);actual={'value':value,'error':error}
    elif kind == 'speaking':
        actual=sval(data['transcript'],data['part'],data['durationMs'],data['promptText'],data['transcriptOrigin'],data['pronunciationAvailable'])
    elif kind == 'dictionary_presentation':actual=present(data['entry'])
    elif kind == 'context_form':actual=matches_context_form(data['entry'],data['surface'],data.get('parts'))
    elif kind == 'translation_revision':actual=revise_dictionary_translations(data['entries'],data['plan'])
    elif kind == 'listening_type':
        value=resolve_listening_type(data['alias']);actual={k:value[k] for k in ('id','storageType')} if value else None
    else:raise AssertionError('Unknown fixture kind')
    assert actual == case['expected'], {'kind':kind,'input':data,'actual':actual,'expected':case['expected']}
