"""Bounded roster file decoding and spreadsheet output."""
from __future__ import annotations

import base64
import binascii
import csv
import io
import unicodedata
import zipfile
from dataclasses import dataclass
from typing import Literal, Sequence

from defusedxml.common import DefusedXmlException
from defusedxml import ElementTree
from openpyxl import Workbook, load_workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.utils.cell import column_index_from_string
from openpyxl.utils.exceptions import InvalidFileException

FileFormat = Literal['csv', 'xlsx']
MAX_FILE = 3_000_000
MAX_ROWS = 10_000
MAX_COLUMNS = 50
MAX_CELL = 1024
MAX_ZIP_BYTES = 24_000_000
SHEET_NAMESPACE = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'

FIELDS = ('external_id', 'name', 'email', 'role', 'user_id')
ALIASES = {
    'external_id': ('external id', 'source id', 'id', 'tashqi id', 'внешний id', 'идентификатор'),
    'name': ('name', 'full name', 'fio', 'ism', 'ism familiya', 'фио', 'имя'),
    'email': ('email', 'e-mail', 'электронная почта', 'почта', 'elektron pochta'),
    'role': ('role', 'rol', 'роль'),
    'user_id': ('user id', 'account id', 'canonical id', 'hisob id', 'id пользователя'),
}


class FileError(ValueError):
    """A bounded, user-correctable file error."""


@dataclass(frozen=True)
class Table:
    headers: list[str]
    rows: list[tuple[int, list[str], frozenset[int]]]
    sheets: list[str]
    sheet: str | None


def decode(value: str) -> bytes:
    try:
        data = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise FileError('invalid_file') from exc
    if not data:
        raise FileError('empty_file')
    if len(data) > MAX_FILE:
        raise FileError('file_too_large')
    return data


def normalized_header(value: str) -> str:
    value = unicodedata.normalize('NFKC', value).casefold().replace('_', ' ')
    return ' '.join(value.split())


def suggest(headers: list[str]) -> dict[str, int]:
    result = {}
    for field in FIELDS:
        matches = [index for index, header in enumerate(headers)
                   if normalized_header(header) in ALIASES[field]]
        if len(matches) == 1:
            result[field] = matches[0]
    return result


def _table(raw, sheets: list[str], sheet: str | None) -> Table:
    headers: list[str] | None = None
    rows: list[tuple[int, list[str], frozenset[int]]] = []
    for number, values, formulas in raw:
        if number > MAX_ROWS + 1:
            raise FileError('row_limit')
        if len(values) > MAX_COLUMNS or any(len(value) > MAX_CELL or '\x00' in value for value in values):
            raise FileError('cell_limit')
        if headers is None:
            headers = [value.strip() for value in values]
            if not any(headers) or formulas:
                raise FileError('invalid_headers')
            continue
        if any(value.strip() for value in values) or formulas:
            if len(values) > len(headers):
                raise FileError('column_mismatch')
            rows.append((number, values, formulas))
    if headers is None:
        raise FileError('empty_file')
    return Table(headers, rows, sheets, sheet)


def _csv(data: bytes) -> Table:
    source = data.decode('utf-8-sig')
    delimiters = (',', ';', '\t')
    selected = max(delimiters, key=lambda delimiter: len(next(csv.reader(io.StringIO(source), delimiter=delimiter), [])))
    reader = csv.reader(io.StringIO(source, newline=''), delimiter=selected, strict=True)
    return _table(((i, values, frozenset()) for i, values in enumerate(reader, 1)), [], None)


def _check_xlsx(data: bytes) -> None:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        items = archive.infolist()
        if len(items) > 150 or sum(i.file_size for i in items) > MAX_ZIP_BYTES:
            raise FileError('file_too_large')
        paths = {i.filename for i in items}
        if len(paths) != len(items) or any('..' in path.split('/') or '\\' in path or path.startswith('/')
                                            for path in paths):
            raise FileError('invalid_file')
        if '[Content_Types].xml' not in paths or 'xl/workbook.xml' not in paths:
            raise FileError('invalid_file')
        if any('vbaproject' in path.casefold() or path.startswith('xl/externalLinks/') for path in paths):
            raise FileError('unsupported_workbook')
        for item in items:
            if not item.filename.startswith('xl/worksheets/') or not item.filename.endswith('.xml'):
                continue
            with archive.open(item) as sheet:
                for _, element in ElementTree.iterparse(sheet,events=('end',),forbid_dtd=True):
                    if element.tag == SHEET_NAMESPACE+'c':
                        address = element.get('r', '')
                        column = address.rstrip('0123456789')
                        if column and column_index_from_string(column)>MAX_COLUMNS:
                            raise FileError('cell_limit')
                    element.clear()


def _xlsx(data: bytes, sheet: str | None) -> Table:
    _check_xlsx(data)
    workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=False, keep_links=False)
    try:
        sheets = [item.title for item in workbook.worksheets if item.sheet_state == 'visible']
        if not sheets or len(sheets) > 20 or sheet is not None and sheet not in sheets:
            raise FileError('invalid_sheet')
        chosen = sheet or sheets[0]
        worksheet = workbook[chosen]
        # Use the actual cells. Stale Excel dimension metadata can omit real rows.
        if worksheet.max_column is not None and worksheet.max_column > MAX_COLUMNS:
            raise FileError('cell_limit')
        worksheet.reset_dimensions()
        def rows():
            for index, cells in enumerate(worksheet.iter_rows(max_col=MAX_COLUMNS), 1):
                values = [str(cell.value) if cell.value is not None else '' for cell in cells]
                while values and not values[-1]:
                    values.pop()
                yield index, values, frozenset(i for i, cell in enumerate(cells) if cell.data_type in ('f', 'e'))
        return _table(rows(), sheets, chosen)
    finally:
        workbook.close()


def parse(data: bytes, kind: FileFormat, sheet: str | None) -> Table:
    try:
        if kind == 'csv' and sheet is not None:
            raise FileError('invalid_sheet')
        return _xlsx(data, sheet) if kind == 'xlsx' else _csv(data)
    except FileError:
        raise
    except (ValueError, OSError, UnicodeError, csv.Error, zipfile.BadZipFile, InvalidFileException,
            DefusedXmlException, KeyError, SyntaxError, OverflowError, IndexError, TypeError) as exc:
        raise FileError('invalid_file') from exc


def _csv_cell(value: object) -> str:
    text = '' if value is None else str(value)
    if text.lstrip().startswith(('=', '+', '-', '@')) or text.startswith(('\t', '\r', '\n')):
        return "'" + text
    return text


def spreadsheet(kind: FileFormat, headings: Sequence[str], rows: Sequence[Sequence[object]]) -> bytes:
    if kind == 'csv':
        text = io.StringIO(newline='')
        writer = csv.writer(text)
        writer.writerow(headings)
        writer.writerows([_csv_cell(value) for value in row] for row in rows)
        return text.getvalue().encode('utf-8-sig')
    workbook = Workbook(write_only=True)
    sheet = workbook.create_sheet('Directory')
    sheet.append(headings)
    for row in rows:
        cells = [WriteOnlyCell(sheet, value=None if value is None else str(value)) for value in row]
        for cell in cells:
            if cell.value is not None:
                cell.data_type = 's'
        sheet.append(cells)
    result = io.BytesIO()
    workbook.save(result)
    return result.getvalue()


def contains_controls(value: str) -> bool:
    return any(unicodedata.category(char) in ('Cc','Cf') for char in value)
