"""FastAPI APIs and the native browser application in one Python process."""
from fastapi import FastAPI
from .main import app, secure_transport, j
from .browser import router as browser_router
from .study_plan_port import router as study_plan_router
from .study_plan_month_port import router as study_plan_month_router
from .frontend_static import StaticFrontend
from fastapi import HTTPException
from .seo import IndexingPolicy
from .origin_boundary import OriginBoundary
from .request_lifecycle import RequestBudget
from . import live_partner_signaling

browser = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
browser.include_router(browser_router)
browser.include_router(study_plan_router)
browser.include_router(study_plan_month_router)
browser.middleware('http')(secure_transport)


@browser.exception_handler(HTTPException)
async def browser_error(req, exc):
    return j({'error': exc.detail}, exc.status_code, {'Cache-Control': 'private, no-store'})


static = StaticFrontend()


async def dispatch(scope, receive, send):
    if scope['type'] in ('http', 'websocket') and scope['path'].startswith(live_partner_signaling.PREFIX + '/'):
        target = live_partner_signaling.dispatch
    elif scope['type'] != 'http':
        target = app
    elif scope['path'].startswith(('/api/frontend/', '/api/study-plan/')) or scope['path'] == '/api/study-plan':
        target = browser
    elif scope['path'] == '/api' or scope['path'].startswith('/api/'):
        target = app
    else:
        target = static
    await target(scope, receive, send)


application = IndexingPolicy(OriginBoundary(RequestBudget(dispatch)))
