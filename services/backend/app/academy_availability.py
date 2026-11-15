"""Availability dependency shared by the Academy and Tuition routers."""
from fastapi import HTTPException

from .runtime_config import academy_enabled


async def require_academy() -> None:
    if not academy_enabled():
        raise HTTPException(404, 'Not Found', headers={'Cache-Control': 'private, no-store'})
