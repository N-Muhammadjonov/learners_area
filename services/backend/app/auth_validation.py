"""Public auth validation messages and ordering from main's Zod schemas."""
import re
from .js_text import trim, words

EMAIL = re.compile(r"^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$", re.I | re.ASCII)


def length(value):
    return len(value.encode('utf-16-le', errors='surrogatepass')) // 2


def typename(value):
    if isinstance(value, str):return 'string'
    if value is None:return 'null'
    if isinstance(value, bool):return 'boolean'
    if isinstance(value, (int, float)):return 'number'
    if isinstance(value, list):return 'array'
    return 'object'


def validate(body, mode):
    if not isinstance(body, dict):
        return None, 'Expected object, received ' + typename(body)
    fields = {'login': ('email','password'), 'register': ('name','email','password','gender'),
              'request': ('email',), 'confirm': ('token','password')}[mode]
    result = {}
    for field in fields:
        if field not in body:return None, 'Required'
        value = body[field]
        if field == 'gender':
            if value not in ('male','female'):
                return None, "Expected 'male' | 'female', received " + typename(value) if not isinstance(value,str) else "Invalid enum value. Expected 'male' | 'female', received '" + value + "'"
        elif not isinstance(value, str):return None, 'Expected string, received ' + typename(value)
        if field in ('email','name'):value = trim(value)
        if field == 'email':
            value = value.lower()
            if not EMAIL.fullmatch(value):return None, 'Enter a valid email'
        elif field == 'name':
            if length(value) < 3:return None, 'String must contain at least 3 character(s)'
            if length(value) > 200:return None, 'String must contain at most 200 character(s)'
            if len(words(value)) < 2:return None, 'First and last name required'
        elif field == 'token' and length(value) < 10:return None, 'String must contain at least 10 character(s)'
        elif field == 'password':
            minimum = 1 if mode == 'login' else 8
            if length(value) < minimum:return None, 'Password is required' if mode == 'login' else 'Password must be at least 8 characters'
        result[field] = value
    return result, None
