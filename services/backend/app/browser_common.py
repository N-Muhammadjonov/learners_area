"""Bounded, explicit selector helpers shared by browser presentation reads."""
from __future__ import annotations

import inspect
import json
import re
from urllib.parse import parse_qsl, urlsplit
from fastapi import HTTPException, Request
from . import main as core


def camel(row):
    if row is None:
        return None
    def name(k):
        parts = k.split('_')
        return parts[0] + ''.join(part[:1].upper() + part[1:] for part in parts[1:])
    return core.row_to_dict({name(k): v for k, v in dict(row).items()})


def identifier(value):
    result = core.uuid_value(value)
    if result is None:
        raise HTTPException(404, 'not_found')
    return result


def number(value, default=1, maximum=10000):
    try:
        n = int(str(value))
        return max(1, min(n, maximum))
    except (ValueError, TypeError):
        return default


def query(value):
    try:
        return dict(parse_qsl(value, keep_blank_values=True, max_num_fields=80))
    except ValueError:
        raise HTTPException(400,'invalid_query')


def live(alias=''):
    p = alias + '.' if alias else ''
    return f"({p}publication_state='published' OR ({p}publication_state='scheduled' AND {p}publish_at<=NOW()))"


def require_role(user, roles):
    if user['role'] not in roles:
        raise HTTPException(403, 'forbidden')


async def existing(req, destination):
    """Call an existing Python GET endpoint directly, retaining all of its guards.

    Destinations are chosen in server code. Browser input never selects an API
    handler or supplies authority, and no HTTP/Node proxy is involved.
    """
    parsed = urlsplit(destination)
    scope = {**req.scope, 'method': 'GET', 'path': parsed.path,
             'raw_path': parsed.path.encode(), 'query_string': parsed.query.encode()}
    request = Request(scope, req.receive)
    for route in core.app.routes:
        if 'GET' not in (getattr(route, 'methods', None) or ()):
            continue
        match = route.path_regex.fullmatch(parsed.path)
        if not match:
            continue
        values = match.groupdict()
        for key in values:
            converter = route.param_convertors.get(key)
            if converter:
                values[key] = converter.convert(values[key])
        for name, param in inspect.signature(route.endpoint).parameters.items():
            if name in ('req', 'request'):
                values[name] = request
        response = await route.endpoint(**values)
        if not hasattr(response, 'body'):
            raise HTTPException(503, 'presentation_read_unavailable')
        try:
            body = json.loads(response.body)
        except (TypeError, ValueError):
            raise HTTPException(503, 'presentation_read_unavailable')
        if response.status_code >= 400:
            raise HTTPException(response.status_code, body.get('error', 'request_failed'))
        return body
    raise HTTPException(404, 'not_found')


async def material_blocks(con, owner_type, owner_id):
    return [camel(r) for r in await con.fetch('''SELECT id,type,position,text_content,link_url,
        object_key,original_name,mime_type,size FROM resource_blocks
        WHERE owner_type=$1 AND owner_id=$2 ORDER BY position,id''', owner_type, owner_id)]


def safe_resource(key):
    if not key:
        return None
    if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9/_.-]{0,299}', key) or '..' in key:
        return None
    return '/api/resources/' + key
