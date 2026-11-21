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
    '5735409a-78f2-4b4a-832e-d5417e41a1f9': '11-australian-parrots-and-their-adaptation-to-habitat-change',
    '5d7d99b4-56e4-4156-9d14-3d5e6a567fd2': '12-the-science-of-sleep',
    '36692ee8-3270-550e-8db1-b2df4f2ebd5a': '13-the-pesticide-free-village',
    'b5785e74-2761-5a9a-8abf-acb6077b3f77': '14-born-to-trade',
    'd603e4d4-d8ec-4c30-a8f9-b0a08d38332e': '15-decision-decision',
    'f07e1599-b53b-4cae-85a5-4638138b5089': '16-ahead-of-its-time',
    'd060dc0e-6cc0-417b-bc52-6bbf316f84c1': '17-iq-scores',
    '97a38d78-0fa8-47f6-91f7-8dde225c4ef3': '18-sir-francis-ronalds-and-telegraph',
    '310881c8-372d-4909-917e-d4f8ccdd5c55': '19-deep-sea-discovery',
    'b7b3121e-5be7-44f0-980d-37f82e6d9817': '20-walking-and-shoes-in-eighteenth-century-london',
    '32f7b422-dad6-5e10-8617-305ce4e0379d': '21-pacific-navigation-and-voyaging',
    'fb9cb14b-b121-4da7-a88d-d2ab80f915c5': '22-the-origins-of-weather-forecasting',
    '1beabd1f-7573-5aee-89c1-f85a5bbc9b34': '23-the-horseshoe-crab',
    'c8b101f0-309f-4488-bf91-1ba27610bf27': '24-the-long-view',
    '1c34e3d3-4d33-4f14-b9f8-a0af1c074fc2': '25-the-terracotta-army',
    'c8c67ae2-2fcc-4f98-8ecc-474b8ab4e50a': '26-why-are-so-few-tigers-man-eaters',
    'b56d0ee8-4d35-4f6f-b0c6-7f0034bb8362': '27-nature-works-polylactic-acid',
    '4ec97757-ff70-50a0-8ce0-3f65101b4a0e': '28-listening-to-the-ocean',
    '4af93fc7-94d0-4b3b-858a-ef9aaa868392': '29-skyscraper-farming',
    '11c1b328-7f5c-5aba-87d7-6e80a579591b': '30-marketing-and-the-information-age',
    'eff317d4-3539-5aef-88e5-48c8e6a6521d': '31-multiple-intelligences',
    '280253ac-d3b2-4ffa-9610-575898921399': '32-the-importance-of-law',
    'f5677547-0bf5-451f-a00b-38f3ace80989': '33-marketing-and-mind-control',
    '1c078bff-1dac-5b27-83e4-3409b2b20c6b': '34-sorry-who-are-you',
    '664cd028-f71d-469d-8aa3-93ed0928c671': '35-bestcom-considerate-computing',
    'b98c6797-4fc5-52d9-8bc1-91cb3481cd7b': '36-a-new-stage-in-the-study-and-teaching-of-history',
    'b728ae0a-e8ae-55ed-8207-6d3c26c55a0e': '37-computer-games',
    '78bea3b5-e207-51b0-8fd9-6fb412475c96': '38-art-and-engineering',
    '527ab881-aa59-5158-8eab-51454415d003': '39-inside-the-mind-of-a-fan',
    '68eadedc-a8b4-4627-a081-e8870251a514': '40-when-maps-were-made-for-the-public',
    '8301c30b-2f7e-435b-b172-dd8a1218b2c6': '41-can-we-prevent-the-poles-from-melting',
    'e297f950-f8b1-510a-8508-b398ab94ebd3': '42-crossing-the-threshold',
    '5cd2c851-83f2-41d1-89c6-08d0b689119b': '43-studies-in-the-history-of-art-and-visual-culture',
    '192192cb-8cd0-5fea-8d5e-6632101e2e10': '44-the-dingo-debate',
    'c5bcc96b-e03f-4026-bf59-431d6b067f5a': '45-what-makes-a-musical-expert',
    '3da11ebe-3430-455f-977f-8b45f4a95f71': '46-katherine-mansfield',
    '17040884-1af0-4104-8694-ee94bdf4050a': '47-jellyfish-the-dominant-species',
    '2d8e4da9-1945-5ad1-8a82-0081b9e5b905': '48-conformity',
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
