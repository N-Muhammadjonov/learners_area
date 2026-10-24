"""Public API and private renderer adapter, served by one Python process."""
from fastapi import FastAPI
from .main import app
from .frontend import router, FrontendOriginMiddleware

renderer = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
renderer.include_router(router)


async def dispatch(scope, receive, send):
    target = renderer if scope['type'] == 'http' and scope['path'].startswith('/_frontend/') else app
    await target(scope, receive, send)


application = FrontendOriginMiddleware(dispatch)
