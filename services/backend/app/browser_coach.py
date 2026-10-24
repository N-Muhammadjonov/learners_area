"""The target Coach vocabulary and explainable recommendation ranking."""
import json
from pathlib import Path
from .browser_common import camel

META = json.loads(Path(__file__).with_name('coach_categories.json').read_text())


async def coach(con, uid):
    rows = [camel(r) for r in await con.fetch('''SELECT category,occurrence_count,recent_severity,status,last_seen_at
        FROM coach_weaknesses WHERE user_id=$1 ORDER BY last_seen_at DESC''', uid)]
    weaknesses = [{**r, **META[r['category']]} for r in rows if r['category'] in META]
    def weight(r):
        return {'high':3,'medium':2,'low':1}.get(r['recentSeverity'], 1) * 2 + min(r['occurrenceCount'], 5) + {'open':3,'improving':1,'resolved':0}[r['status']]
    groups = {}
    for r in sorted((r for r in weaknesses if r['status'] != 'resolved'), key=weight, reverse=True):
        area = r['area']
        if area in groups:
            groups[area]['categories'].append(r['category'])
            groups[area]['score'] += min(weight(r), 3)
        else:
            groups[area] = {'area': area, 'href': r['href'], 'categories': [r['category']], 'reason': r['action'], 'occurrenceCount': r['occurrenceCount'], 'score': weight(r)}
    recommendations = [{k:v for k,v in r.items() if k != 'score'} for r in sorted(groups.values(), key=lambda r:r['score'], reverse=True)[:3]]
    evaluations = [camel(r) for r in await con.fetch('SELECT id,evaluation_type,overall_estimate,verdict,created_at FROM evaluations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 8', uid)]
    return {'weaknesses': weaknesses, 'recommendations': recommendations, 'recentEvaluations': [{**r, 'checkedByName':'RIWI'} for r in evaluations]}
