"""Public API and private renderer adapter, served by one Python process."""
from fastapi import FastAPI
from .main import app, secure_transport, j
from .frontend import router, FrontendOriginMiddleware
from .browser import router as browser_router
from .frontend_static import StaticFrontend
from fastapi import HTTPException

renderer = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
renderer.include_router(router)
browser = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
browser.include_router(browser_router)
browser.middleware('http')(secure_transport)


@browser.exception_handler(HTTPException)
async def browser_error(req, exc):
    return j({'error': exc.detail}, exc.status_code, {'Cache-Control': 'private, no-store'})


static = StaticFrontend()


async def dispatch(scope, receive, send):
    if scope['type'] != 'http':
        target = app
    elif scope['path'].startswith('/_frontend/'):
        target = renderer
    elif scope['path'].startswith('/api/frontend/'):
        target = browser
    elif scope['path'] == '/api' or scope['path'].startswith('/api/'):
        target = app
    else:
        target = static
    await target(scope, receive, send)


application = FrontendOriginMiddleware(dispatch)
