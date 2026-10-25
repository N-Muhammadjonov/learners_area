"""Stable numbered Listening order, independent of upload time and replacement UUIDs."""
import json
import re
from pathlib import Path

_ORIGINAL_NUMBERS={key:value['number'] for key,value in json.loads(Path(__file__).with_name('original_listening_catalogue.json').read_text()).items()}
_ORIGINAL_NUMBERS['listening-test-1']=1
_LABEL=re.compile(r'(?:^|[^a-z])(?:listening[\s_-]*)?(?:test|mcq|day|kun)[\s_#:.\-–—]*(\d+)',re.I)


def _number(value):
    match=_LABEL.search(str(value or ''))
    return int(match[1]) if match else None


def _natural(value):
    return tuple((0,int(part)) if part.isdigit() else (1,part.casefold()) for part in re.split(r'(\d+)',str(value or '')) if part)


def material_order(row):
    source=row.get('source_id') or row.get('source_ref') or ''
    ordinal=row.get('program_ordinal')
    # MCQ programme position is authored data. Original study packs also have an explicit number.
    number=ordinal if isinstance(ordinal,int) and ordinal>0 else _ORIGINAL_NUMBERS.get(source)
    if number is None:number=_number(row.get('title'))
    if number is None:number=_number(source)
    if number is None:
        values=row.get('payload') or {}
        if isinstance(values,str):
            try:values=json.loads(values)
            except ValueError:values={}
        number=_number(values.get('testId')) if isinstance(values,dict) else None
    if number is None:
        match=re.search(r'\d+',str(row.get('title') or ''))
        if match:number=int(match[0])
    return (number is None,number or 0,_natural(row.get('title')),str(source).casefold(),str(row.get('id') or ''))
