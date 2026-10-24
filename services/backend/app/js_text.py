"""ECMAScript text boundaries used by the existing public grading contract."""
import re

SPACE = ' \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
SPACES = re.compile('[' + SPACE + ']+')


def collapse(value):
    return SPACES.sub(' ', value)


def trim(value):
    return value.strip(SPACE)


def words(value):
    return [part for part in SPACES.split(trim(value)) if part]


def length(value):
    return len(value.encode('utf-16-le', errors='surrogatepass')) // 2


def slice(value, start=0, end=None):
    data=value.encode('utf-16-le', errors='surrogatepass')
    total=len(data)//2
    left=max(0,total+start) if start<0 else min(start,total)
    right=total if end is None else max(0,total+end) if end<0 else min(end,total)
    return data[left*2:right*2].decode('utf-16-le', errors='surrogatepass')
