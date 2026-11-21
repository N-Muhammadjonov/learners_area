"""Read the reviewed vocabulary packaged inside standalone passage HTML."""
from __future__ import annotations

from functools import lru_cache
from hashlib import sha256
import json
import os
from pathlib import Path

from .reading_lexical_policy import is_verified_reading_gloss

_PASSAGES = {
    'ae529b05-0e9f-56f1-8dbc-e96455684ab8': '03-charles-darwin-in-the-office',
    '818290cd-9f13-4f06-b453-6e1012552c63': '04-is-graffiti-art-or-crime',
    '22a5f6cd-d48d-4ea0-b2db-e87748a23955': '05-life-casting-and-art',
    '94e45a16-0f2b-4de0-b6f7-80f74ccfeb43': '06-hypnotism',
    '39b59e1e-1895-50a7-83be-7cc712c89272': '07-fishbourne-roman-palace',
    'd4e2ae83-5835-5fc1-8548-357bb1ab31ae': '08-preserving-antarctic-history',
    '0025a569-110d-4933-a948-604d356326d2': '09-the-well-being-life',
    '1a5dca1f-fd5e-4f86-8dae-b1183a40cc83': '10-the-development-of-plastics',
}
_DEFAULT_DIST = Path(__file__).resolve().parents[3] / 'frontend' / 'vanilla' / 'build'
_GLOSSARY_TAG = '<script type="application/json" id="reading-glossary">'


def has_passage_html(passage_id: object) -> bool:
    return str(passage_id) in _PASSAGES


@lru_cache(maxsize=64)
def _read_glossary(dist: Path, source: str) -> dict | None:
    path = dist / 'modules' / 'reading' / 'passage-assets' / (_PASSAGES[source] + '.html')
    try:
        markup = path.read_text(encoding='utf-8')
        document = json.loads(markup.split(_GLOSSARY_TAG, 1)[1].split('</script>', 1)[0])
    except (OSError, IndexError, ValueError):
        return None
    if not isinstance(document, dict) or document.get('sourceId') != source:
        return None
    return document


def passage_glosses(passage_id: object, body: str) -> list[dict] | None:
    """Only use these offsets when the reader's source text matches the HTML."""
    source = str(passage_id)
    if source not in _PASSAGES or not isinstance(body, str):
        return None
    document = _read_glossary(Path(os.getenv('FRONTEND_DIST', str(_DEFAULT_DIST))), source)
    if not document or document.get('checksum') != sha256(body.encode()).hexdigest():
        return None
    rows = []
    previous_end = 0
    for occurrence_id, start, end, pos, definition, translation in document['entries']:
        if type(start) is not int or type(end) is not int or start < previous_end:
            return None
        row = {'id': occurrence_id, 'start_char': start, 'end_char': end,
               'surface_form': body[start:end], 'part_of_speech': pos,
               'definition_en': definition, 'translation_uz': translation}
        if not is_verified_reading_gloss(body, row):
            return None
        rows.append(row)
        previous_end = end
    return rows or None
