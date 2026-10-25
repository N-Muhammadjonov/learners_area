"""Private source preservation and exact existing QA HOLD scoring evidence."""
import json
from pathlib import Path
import pytest
from app.browser_staff_content import staged

ROOT=Path(__file__).resolve().parents[1]/'assets/retention-v2'
EVIDENCE=json.loads((ROOT/'calibration-gaps.json').read_text())


@pytest.mark.parametrize('level',('A2','B1','B2','C1','C2'))
def test_staged_review_matches_owner_content_and_existing_calibration(level):
    report=staged(level)['report']
    assert report['holdStatus']=='QA_HOLD_DO_NOT_PUBLISH'
    authored=[json.loads(line) for line in (ROOT/(level+'.jsonl')).read_text().splitlines()]
    assert len(report['items'])==15
    assert [(r['sourceId'],r['bodyText']) for r in report['items']]==[(r['sourceId'],r['bodyText']) for r in authored]
    expected={(r['sourceId'],r['test']):r['got'] for r in EVIDENCE['anomalies']}
    for item in report['items']:
        assert 'scoringStructure' not in item
        assert item['sourceScore']==expected.get((item['sourceId'],'source'),100)
        assert item['canonicalScore']==expected.get((item['sourceId'],'canonical'),100)
