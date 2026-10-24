"""Public API and private renderer adapter, served by one Python process."""
from fastapi import FastAPI
from .main import app
from .frontend import router, FrontendOriginMiddleware
from .preview_contract import current_preview

renderer = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
renderer.include_router(router)


async def dispatch(scope, receive, send):
    target = renderer if scope['type'] == 'http' and scope['path'].startswith('/_frontend/') else app
    token = current_preview.set(True)
    try:
        await target(scope, receive, send)
    finally:
        current_preview.reset(token)


application = FrontendOriginMiddleware(dispatch)
