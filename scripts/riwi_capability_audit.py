#!/usr/bin/env python3
"""Executable capability gate. Passing engineering checks cannot certify a model.

All diagnostic responses are original authored fixtures. They have no fabricated
examiner band labels. The script never calls a provider or a shared database.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'services/backend'))
from app.riwi_assessment_contracts import BASEBOOK,ASSESSMENT_CONTRACTS,get_assessment_contract
from app.riwi_evaluation.dataset import generate_cases,validate_splits
from app.step32_writing_riwi import wval
from app.step31_riwi_evaluators import vval


def audit():
    # Same response, different clearly unrelated task: response-length and
    # vocabulary-count bands alone must not establish task relevance.
    answer=('Public buses allow residents to travel to work without buying a car. '
        'Affordable tickets help families save money, while reliable services reduce traffic. '
        'For these reasons, cities should support frequent and accessible public transport. ')*8
    related='Should cities subsidise public buses? Give reasons and examples.'
    unrelated='Should schools replace classroom teaching with online courses? Give reasons and examples.'
    a=wval('task2',related,answer,250)
    b=wval('task2',unrelated,answer,250)
    score=lambda x:[(c['key'],c['band']) for c in x['criteria']]
    detects_change=score(a)!=score(b) or a['issues']!=b['issues']
    wrong_sense=vval('bank','a financial institution that holds money',
        'The bank is covered with grass beside the river.')
    model_root=ROOT/'services/backend/app/models'
    weights=sorted(str(p.relative_to(ROOT)) for ext in ('*.onnx','*.gguf','*.safetensors')
        for p in model_root.rglob(ext)) if model_root.exists() else []
    curriculum=[]
    for task in BASEBOOK['tasks']:
        contract=get_assessment_contract(task['key'])
        compiled=bool(contract and all(v in contract.task_rules for v in (task['focus'],task['method'],task['guard'])))
        curriculum.append({'source_task':task['key'],'registry_key':contract.key if contract else None,
            'prompt_version':contract.version if contract else None,'rubric_version':contract.rubric_version if contract else None,
            'source_rules_composed':compiled,'semantic_acceptance_verified':False,
            'execution':contract.execution if contract else None})
    blockers=[]
    if not weights:blockers.append('no_trained_language_model_artifact_in_candidate')
    if not detects_change:blockers.append('writing_task_relevance_counterexample')
    if wrong_sense['verdict']=='correct':blockers.append('vocabulary_canonical_sense_usage_counterexample')
    blockers.append('independent_subjective_reference_not_established')
    source=ROOT/'services/backend/contracts/riwi_basebook_v1.json'
    runtime={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest()
             for p in sorted((ROOT/'services/backend/app').rglob('*.py'))}
    return {'schema_version':1,'checkpoint_before_request':'131afaf59c534031d9b8d9fb26b3d395ffd45d17',
        'audited_commit':subprocess.check_output(['git','-C',str(ROOT),'rev-parse','HEAD'],text=True).strip(),
        'source_book':BASEBOOK['source'],'contract_file_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
        'registered_contracts':len(ASSESSMENT_CONTRACTS),'source_task_contracts':len(curriculum),
        'curriculum':curriculum,'exercise_dataset':validate_splits(generate_cases()),
        'training':{'trained_model_artifacts':weights,'training_run_executed':False,
            'trained_parameter_count':None,'reason':'Current RIWI uses deterministic checks and configured external engines. NumPy/ONNX Runtime availability is not a trained language model. No pretrained language model or language-model fine-tuning stack/reference benchmark is part of this candidate.',
            'prompt_composition_is_parameter_training':False,'provider_calls':0},
        'diagnostics':{'writing_relevance':{'on_topic_criterion_values':score(a),
            'off_topic_criterion_values':score(b),'relevance_sensitive':detects_change,
            'reference':'Original public-transport response is unrelated to the online-schooling question; no reference band was assigned.'},
            'vocabulary_sense':{'target':'bank','canonical_definition':'a financial institution that holds money',
                'response':'The bank is covered with grass beside the river.','actual_verdict':wrong_sense['verdict'],
                'reference':'This uses the river-edge sense, not the supplied financial sense.'}},
        'runtime_sha256':runtime,'limitations':['Pronunciation is correctly Not assessed without an acoustic provider; this is an allowed Basebook capability boundary, not a fabricated score.'],
        'main_merge_authorization':{'received':True,'date':'2026-11-02',
            'condition':'Complete requested capabilities, training and validation before merging.','condition_satisfied':False},
        'blockers':blockers,'all_requested_capabilities_validated':False,'merge_ready':False,
        'production_ready':False,'main_merge_performed':False}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    result=audit()
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:result[k] for k in ['registered_contracts','source_task_contracts','training','diagnostics','blockers','merge_ready']},ensure_ascii=False))
    return 0 if result['merge_ready'] else 1

if __name__=='__main__':raise SystemExit(main())
