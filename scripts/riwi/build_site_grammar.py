"""Index all shipped grammar rules; deliberately exclude exercise items/keys."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'frontend/vanilla/modules/grammar'
OUTPUT = ROOT / 'services/backend/contracts/riwi_site_grammar_v1.json'


def compile_pack():
    entries, hashes = [], {}
    for path in sorted([*SOURCE.glob('book-content-*.js'), *SOURCE.glob('book-skill-source-*.json')]):
        raw = path.read_bytes()
        hashes[str(path.relative_to(ROOT))] = hashlib.sha256(raw).hexdigest()
        if path.suffix == '.js':
            units = json.loads(raw.decode().split('export default', 1)[1].strip().removesuffix(';'))
            for unit in units:
                rule = unit['rule']
                entries.append({'id': unit['id'], 'track': 'grammar', 'title': unit['title'],
                    'pattern': rule['title'], 'pointsUz': rule['points'], 'table': rule['table'],
                    'examples': [{'en': x[0], 'uz': x[1]} for x in rule['examples']],
                    'stages': [{'title': s['name'], 'kinds': [e['kind'] for e in s['ex']]} for s in unit['stages']]})
        else:
            data = json.loads(raw)
            for unit in data['units']:
                entries.append({'id': unit['id'], 'track': data['kind'], 'title': unit['title'],
                    'pattern': unit['formula'], 'pointsUz': [unit['specific_rule'], unit['simple_explanation']],
                    'table': [], 'examples': unit['examples'],
                    'stages': [{'title': s['title'], 'kinds': [g['type'] for g in s['groups']]} for s in unit['stages']]})
    assert len(entries) == 277 and len({e['id'] for e in entries}) == 277
    assert all(len(e['examples']) >= 3 for e in entries)
    return {'version': 'riwi-site-grammar-v1', 'sourceHashes': hashes, 'entries': entries}


if __name__ == '__main__':
    OUTPUT.write_text(json.dumps(compile_pack(), ensure_ascii=False, indent=2) + '\n')
