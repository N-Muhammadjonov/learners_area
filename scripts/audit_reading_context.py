"""Audit an exported Reading corpus without connecting to or changing a database.

Inputs: reading_passages rows and lexical_occurrences JOIN lexemes rows as JSON.
Compact occurrence exports use the column order in OCCURRENCE_COLUMNS below.
Counts refer to English word occurrences, not dictionary headword counts.
"""
from __future__ import annotations
import argparse
import collections
import hashlib
import json
from pathlib import Path
import re
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'services/backend'))
from app.reading_lexical_policy import reading_glosses, is_reading_pronoun

OCCURRENCE_COLUMNS='id passage_id lexeme_id start_char end_char surface_form resolution_status resolution_source term definition_en translation_uz verification_status provenance sense_key occurrence_type segment_key part_of_speech'.split()
WORDS=re.compile(r"[A-Za-z]+(?:['’\u2011-][A-Za-z]+)*")


def audit(passages, occurrences):
    by_passage=collections.defaultdict(list)
    for row in occurrences:
        item=dict(zip(OCCURRENCE_COLUMNS,row)) if isinstance(row,list) else row
        by_passage[item['passage_id']].append(item)
    results=[]
    for passage in passages:
        if not passage.get('is_active') or passage.get('test_no') is None or passage.get('passage_no') is None:
            continue
        body=passage['body_text'];rows=by_passage[passage['id']]
        projected=reading_glosses(body,[r for r in rows if r.get('resolution_status')=='resolved'])
        invalid=[];empty=[]
        for row in rows:
            start,end=row.get('start_char'),row.get('end_char')
            if type(start) is not int or type(end) is not int or start<0 or end<=start or end>len(body) or body[start:end].casefold()!=str(row.get('surface_form','')).casefold():
                invalid.append(row['id'])
            if not (row.get('definition_en') or '').strip() or not (row.get('translation_uz') or '').strip():
                empty.append(row['id'])
        ordered=sorted(rows,key=lambda row:(row.get('start_char') or 0,row.get('end_char') or 0))
        overlaps=[]
        for index,left in enumerate(ordered):
            for right in ordered[index+1:]:
                if right['start_char']>=left['end_char']:break
                if left['start_char']<right['end_char']:overlaps.append([left['id'],right['id']])
        missing=[];covered=0;pronouns=0
        for word in WORDS.finditer(body):
            if is_reading_pronoun(word.group()) or any(
                row.get('start_char') == word.start() and row.get('end_char') == word.end()
                and body[word.start():word.end()].casefold() == str(row.get('surface_form','')).casefold()
                and is_reading_pronoun(row['surface_form'],row.get('part_of_speech')) for row in rows
            ):
                pronouns+=1;continue
            if any(row['start_char']<=word.start() and row['end_char']>=word.end() for row in projected):covered+=1
            else:missing.append({'word':word.group(),'start':word.start(),'end':word.end(),'context':body[max(0,word.start()-90):word.end()+90]})
        results.append({'id':passage['id'],'title':passage['title'],'testNo':passage['test_no'],'passageNo':passage['passage_no'],
            'sourceSha256':hashlib.sha256(body.encode()).hexdigest(),'sourceSpans':len(rows),'projectedSpans':len(projected),
            'coveredWords':covered,'excludedPronouns':pronouns,'missingWords':missing,'missingMeanings':empty,'invalidOffsets':invalid,
            'rawOverlapPairs':overlaps,'projectedOverlapPairs':0,
            'unverifiedLexemeRows':sum(row.get('verification_status')!='verified' for row in rows)})
    totals={'passages':len(results),'sourceSpans':sum(row['sourceSpans'] for row in results),'projectedSpans':sum(row['projectedSpans'] for row in results),
        'missingWords':sum(len(row['missingWords']) for row in results),'missingUniqueSurfaces':len({word['word'].casefold() for row in results for word in row['missingWords']}),
        'missingMeaningsInExistingBindings':sum(len(row['missingMeanings']) for row in results),'invalidOffsets':sum(len(row['invalidOffsets']) for row in results),
        'rawOverlapPairs':sum(len(row['rawOverlapPairs']) for row in results),'projectedOverlapPairs':0,'saveFlowFailures':None,'saveFlowStatus':'not_tested_by_this_audit'}
    return {'scope':'active numbered General Reading; pronoun-only exception; source-bound projection; no inferred translations','totals':totals,'passages':results}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--passages',type=Path,required=True)
    parser.add_argument('--occurrences',type=Path,nargs='+',required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    rows=[row for file in args.occurrences for row in json.loads(file.read_text())]
    report=audit(json.loads(args.passages.read_text()),rows)
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report['totals'],ensure_ascii=False))
