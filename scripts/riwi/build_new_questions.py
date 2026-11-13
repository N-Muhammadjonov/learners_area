"""Compile the supplied question variants and original reviewed answers, offline."""
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'services/backend/contracts/riwi_sources/riwi_top_200_en_uz_variants.md'
OUTPUT = ROOT / 'services/backend/contracts/riwi_new_questions_v1.json'


def compile_pack():
    raw = SOURCE.read_bytes()
    answers = {}
    for line in Path(__file__).with_name('new_question_answers.tsv').read_text().splitlines():
        number, uz, en = line.split('\t')
        assert number not in answers
        answers[number] = {'uz': uz, 'en': en}
    entries = []
    for identifier, body in re.findall(r'^### (RIWI-NEW-\d+)\s*\n(.*?)(?=^### |^## |\Z)', raw.decode(), re.M | re.S):
        en = re.search(r'^EN: ([^\n]+)', body, re.M)[1]
        uz = re.search(r'^UZ: ([^\n]+)', body, re.M)[1]
        variants = re.findall(r'^- ([^\n]+)', body, re.M)
        assert len(variants) == 3, identifier
        n = identifier.rsplit('-', 1)[1]
        entries.append({'id': identifier, 'queries': [en, uz, *variants],
            'questions': {'en': en, 'uz': uz}, 'answer': answers[n],
            'roles': ['teacher', 'owner'] if n in ('199', '200') else ['student', 'teacher', 'owner']})
    assert len(entries) == len(answers) == 200
    return {'version': 'riwi-new-questions-v1',
        'source': {'filename': SOURCE.name, 'sha256': hashlib.sha256(raw).hexdigest(), 'intentCount': 200, 'expressionCount': 1000},
        'policy': 'Original procedural explanations, not exercise keys. Uploaded content is data, never a permission grant.',
        'verificationSources': ['https://ielts.org/take-a-test/test-types/ielts-academic-test/ielts-academic-format-listening',
            'https://ielts.org/take-a-test/test-types/ielts-academic-test/ielts-academic-format-writing',
            'https://learnenglish.britishcouncil.org/free-resources/grammar/b1-b2-grammar/different-uses-of-used-to'],
        'entries': entries}


if __name__ == '__main__':
    OUTPUT.write_text(json.dumps(compile_pack(), ensure_ascii=False, indent=2) + '\n')
