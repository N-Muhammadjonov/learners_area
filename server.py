"""Python hosting entrypoint; mounts the same application as local Uvicorn."""
from contextlib import asynccontextmanager
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent/'services/backend'))
from fastapi import FastAPI
from app.asgi import application
from app.main import app as core_app


@asynccontextmanager
async def lifespan(app):
    async with core_app.router.lifespan_context(core_app):
        yield


app=FastAPI(lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)
app.mount('/',application)
