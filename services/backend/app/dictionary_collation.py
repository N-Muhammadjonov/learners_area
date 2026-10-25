"""English ICU collation for dictionary Uzbek preview sorting (Node Intl.Collator)."""
from __future__ import annotations
import ctypes
import ctypes.util
import re
import unicodedata
from functools import cmp_to_key

_lib = None
_compare = None
_collator = None
try:
    _libname = ctypes.util.find_library('icui18n') or ctypes.util.find_library('icucore')
    if _libname:
        _lib = ctypes.CDLL(_libname)
        _version = re.search(r'\.so\.(\d+)', _libname)
        _suffix = '_' + _version.group(1) if _version else ''
        _open = getattr(_lib, 'ucol_open' + _suffix)
        _open.argtypes = [ctypes.c_char_p, ctypes.POINTER(ctypes.c_int32)]
        _open.restype = ctypes.c_void_p
        _compare = getattr(_lib, 'ucol_strcollUTF8' + _suffix)
        _compare.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int32,
                            ctypes.c_char_p, ctypes.c_int32, ctypes.POINTER(ctypes.c_int32)]
        _compare.restype = ctypes.c_int32
        _err = ctypes.c_int32(0)
        _collator = _open(b'en_US', ctypes.byref(_err))
        if _err.value > 0 or not _collator:raise ValueError('ICU unavailable')
except (AttributeError, ValueError, OSError):
    _compare = None
    _collator = None


def en_locale_compare(a: str, b: str) -> int:
    """Intl.Collator('en') comparator; *no* codepoint tie-break.

    model.ts/stableJson uses a.localeCompare(b,'en') directly, while
    search-index.ts compares locale first and then Unicode codepoint.
    """
    if _collator is not None:
        left, right = a.encode('utf-8'), b.encode('utf-8')
        error = ctypes.c_int32(0)
        result = _compare(_collator, left, len(left), right, len(right), ctypes.byref(error))
        if error.value <= 0:
            return (result > 0) - (result < 0)
    # A case-fold approximation changes immutable release hashes. Refuse it.
    raise RuntimeError('ICU English collation is required; install the ICU runtime')


def en_compare(a: str, b: str) -> int:
    primary = en_locale_compare(a, b)
    return primary or (a > b) - (a < b)


def en_sorted_pairs(pairs):
    return sorted(pairs, key=cmp_to_key(lambda a,b: en_compare(a[0],b[0])))
