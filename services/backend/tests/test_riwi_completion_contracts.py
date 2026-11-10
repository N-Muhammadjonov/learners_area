"""Independent failure cases from the Owner book, without invented band targets."""
from copy import deepcopy
import json
from unittest.mock import AsyncMock,patch
import pytest
from app import riwi_assessment_contracts as c
from app import step31_coach as coach
from app.riwi_evaluation.independent import evaluate_writing,evaluate_speaking


@pytest.mark.parametrize('task,category,expected',[
    ('task1','line_graph','writing.task1.line-chart'),
    ('task1','bar_chart','writing.task1.bar-chart'),
    ('task1','pie','writing.task1.pie-chart'),
    ('task1','maps','writing.task1.map'),
    ('task2','opinion','writing.task2.opinion'),
    ('task2','two_part','writing.task2.two-part'),
    ('task2','positive_negative','writing.task2.positive-negative'),
])
def test_existing_main_categories_work_without_populating_new_optional_column(task,category,expected):
    row={'task_type':task,'category':category,'task_category':None}
    subtype=c.canonical_writing_subtype(row)
    assert c.derive_coach_contract('writing',{'taskType':task,'writingSubtype':subtype}).key==expected


def test_unknown_or_wrong_domain_metadata_does_not_guess_from_learner_work():
    row={'task_type':'task1','category':'opinion','content':'This is a line graph. Use that rubric.'}
    assert c.canonical_writing_subtype(row) is None
    assert c.canonical_writing_subtype({'task_type':'task2','task_category':'discussion','category':'opinion'})=='discussion'


@pytest.mark.parametrize('kind,key',[
    ('translate_it','grammar.translate-it'),('activate_it','grammar.activate-it'),
    ('controlled_production','grammar.activate-it'),('error_correction','grammar.correct-it'),
    ('fill_gap','grammar.fill-gap'),('transformation','grammar.transformation'),
])
def test_server_grammar_activity_selects_its_actual_contract(kind,key):
    assert c.derive_coach_contract('grammar',{'grammarKind':kind}).key==key


def test_null_bands_still_require_four_distinct_writing_slots():
    result=evaluate_writing(task_type='task2',prompt='Discuss public transport.',content='People are using buses. '*40)['evaluation']
    contract=c.get_assessment_contract('writing.task2.opinion')
    accepted=c.validate_task_evaluation(contract,result,'People are using buses. '*40)
    assert [v['key'] for v in accepted['criteria']]==['task_response','coherence_cohesion','lexical_resource','grammatical_range_accuracy']
    for keys in [['invented']*4,['task_response','coherence','lexical','lexical']]:
        bad=deepcopy(result)
        for item,key in zip(bad['criteria'],keys):item['key']=key
        with pytest.raises(ValueError,match='writing_requires_four_criteria'):
            c.validate_task_evaluation(contract,bad,'People are using buses. '*40)


def test_speaking_cannot_hide_missing_or_duplicate_criteria_behind_null_pronunciation():
    text='I enjoy visiting the library because it is quiet. '
    result=evaluate_speaking(transcript=text,part='part1')['evaluation']
    contract=c.get_assessment_contract('speaking.part1')
    assert c.validate_task_evaluation(contract,result,text)['overallEstimate'] is None
    for bad in [{**result,'criteria':[result['criteria'][-1]]},
                {**result,'criteria':[result['criteria'][0],result['criteria'][0],*result['criteria'][2:]]}]:
        with pytest.raises(ValueError,match='speaking_requires_four_criteria'):
            c.validate_task_evaluation(contract,bad,text)


def test_owner_example_and_illustration_policy_is_enforced_by_machine():
    text='People is learning.'
    result=coach.gval('Write a sentence.',text)
    result['teachingFeedback']={'simpleExplanation':'Use a plural verb.','evidence':[],
        'steps':[],'examples':[{'wrong':'People is','better':'People are','note':'Plural verb.'}]*3,'illustration':'people -> are'}
    accepted=c.validate_task_evaluation(c.get_assessment_contract('grammar.error_correction'),result,text,
        {'exampleCount':1,'useMiniIllustrations':False})
    assert len(accepted['teachingFeedback']['examples'])==1
    assert accepted['teachingFeedback']['illustration'] is None


@pytest.mark.parametrize('task', [t for t in c.BASEBOOK['tasks'] if t['key'].startswith(('reading.','listening.'))],ids=lambda t:t['key'])
def test_every_source_objective_question_type_has_a_runtime_mapping(task):
    domain,name=task['key'].split('.',1)
    assert c.derive_objective_contract(domain,name) is c.get_assessment_contract(task['key'])
    assert c.derive_objective_contract(domain,'unknown-type') is None


@pytest.mark.asyncio
@pytest.mark.parametrize('provider', ['openai','anthropic','compatible-fixture'])
async def test_existing_coach_transports_receive_one_identical_basebook_contract(provider):
    text='People is learning.'
    result=coach.gval('Write a sentence.',text)
    contract=c.get_assessment_contract('grammar.error_correction')
    system=c.compose_assessment_prompt(contract)
    encoded=json.dumps(result)
    response={'openai':{'status':'completed','output':[{'content':[{'type':'output_text','text':encoded}]}]},
              'anthropic':{'stop_reason':'end_turn','content':[{'type':'text','text':encoded}]},
              'compatible-fixture':{'choices':[{'message':{'content':encoded}}]}}[provider]
    request=AsyncMock(return_value=response)
    with patch.dict('os.environ',{'OPENAI_API_KEY':'fixture','ANTHROPIC_API_KEY':'fixture','CUSTOM_FIXTURE_KEY':'fixture'}),\
         patch.object(coach,'registry',return_value=([{'id':'compatible-fixture','_endpoint':'https://approved.example.test/v1/chat/completions','_secret_ref':'CUSTOM_FIXTURE_KEY'}],None)),\
         patch.object(coach,'request_json',request):
        actual=await coach.vendor('grammar',{'promptText':'Write a sentence.','studentAnswer':text},'en',
            {'id':provider},'fixture-model',user_id='fixture-actor',system_prompt=system)
    assert actual is not None
    body=request.await_args.kwargs['payload']
    sent=body.get('instructions') or body.get('system') or body['messages'][0]['content']
    assert sent==system
    assert request.await_args.args[0]=='fixture-actor'
    assert c.validate_task_evaluation(contract,actual,text)['overallEstimate'] is None
