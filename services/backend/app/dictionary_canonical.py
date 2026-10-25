"""Dictionary stableJson from src/lib/dictionary/model.ts.

Important: the Dictionary's key comparator is localeCompare('en'), unlike
import/core/identity.ts, which sorts code points. JSON arrays retain order.
"""
from __future__ import annotations
import json
from functools import cmp_to_key
from .dictionary_collation import en_locale_compare


def stable(value):
    if isinstance(value, dict):
        items = sorted(value.items(), key=cmp_to_key(lambda x, y: en_locale_compare(x[0], y[0])))
        return '{' + ','.join(json.dumps(key, ensure_ascii=False, separators=(',', ':'))
                              + ':' + stable(part) for key, part in items) + '}'
    if isinstance(value, list):
        return '[' + ','.join(stable(part) for part in value) + ']'
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
