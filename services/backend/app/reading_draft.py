"""Opaque optimistic draft token; computed under the existing attempt lock."""
import hashlib
import json


def draft_hash(answers):
    canonical=json.dumps(answers,sort_keys=True,separators=(',', ':'),ensure_ascii=False)
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()
