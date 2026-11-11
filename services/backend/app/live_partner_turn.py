"""Short-lived Cloudflare TURN credentials issued exclusively by the backend."""
from __future__ import annotations

import os
import re

import httpx

TTL_SECONDS = 7200
KEY_PATTERN = re.compile(r'^[a-f0-9]{32}$')
TURN_URL = re.compile(r'^turns?:turn\.cloudflare\.com:(?:3478|443|80|5349)\?transport=(?:udp|tcp)$')


def configured() -> bool:
    return bool(KEY_PATTERN.fullmatch(os.getenv('LIVE_PARTNER_TURN_KEY_ID', ''))
                and len(os.getenv('LIVE_PARTNER_TURN_API_TOKEN', '')) >= 32)


async def credentials() -> dict | None:
    if not configured():
        return None
    key_id = os.environ['LIVE_PARTNER_TURN_KEY_ID']
    url = f'https://rtc.live.cloudflare.com/v1/turn/keys/{key_id}/credentials/generate-ice-servers'
    try:
        async with httpx.AsyncClient(timeout=4, follow_redirects=False) as client:
            response = await client.post(url, headers={
                'Authorization': 'Bearer ' + os.environ['LIVE_PARTNER_TURN_API_TOKEN'],
                'Content-Type': 'application/json',
            }, json={'ttl': TTL_SECONDS})
        if not response.is_success:
            return None
        servers = response.json().get('iceServers')
        if isinstance(servers, dict):
            servers = [servers]
        if not isinstance(servers, list):
            return None
        relay = []
        for server in servers:
            if not isinstance(server, dict):
                continue
            urls = server.get('urls', [])
            if isinstance(urls, str):
                urls = [urls]
            urls = [url for url in urls if isinstance(url, str) and TURN_URL.fullmatch(url)] if isinstance(urls, list) else []
            username, credential = server.get('username'), server.get('credential')
            if urls and all(isinstance(value, str) and 0 < len(value) <= 2048 for value in (username, credential)):
                relay.append({'urls': urls, 'username': username, 'credential': credential})
        return {'iceServers': relay, 'iceTransportPolicy': 'relay', 'expiresInSeconds': TTL_SECONDS} if relay else None
    except (httpx.HTTPError, ValueError, TypeError, AttributeError):
        return None
