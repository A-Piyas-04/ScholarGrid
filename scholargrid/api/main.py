"""FastAPI application factory.

``create_app()`` builds the app around one :class:`AppState`. The release loads in the background at
startup unless ``load_on_start=False`` (tests call ``state.load()`` themselves).
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from .. import __version__
from ..llm.context import current_session
from ..utils import get_logger
from .state import AppState, NotReady

log = get_logger("api")


def create_app(state: Optional[AppState] = None, *, load_on_start: bool = True) -> FastAPI:
    from ..config import load_dotenv

    load_dotenv()
    st = state if state is not None else AppState()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if load_on_start and st.bundle is None and not st.loading:
            st.load_async()
        st.get_repo()
        yield
        st.shutdown()

    app = FastAPI(title="ScholarGrid API", version=__version__, lifespan=lifespan,
                  description="Research discovery API: search, topic workspaces, reading paths, open problems, "
                              "research plans and projects over a versioned arXiv CS release.")
    app.state.sg = st

    origins = [o.strip() for o in os.environ.get("SCHOLARGRID_CORS_ORIGINS",
                                                 "http://localhost:3000,http://127.0.0.1:3000").split(",") if o.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False,
                       allow_methods=["*"], allow_headers=["*"])
    app.add_middleware(GZipMiddleware, minimum_size=2048)

    @app.middleware("http")
    async def session_context(request: Request, call_next):
        sid = (request.headers.get("x-sg-session") or "")[:32] or None
        token = current_session.set(sid)
        try:
            return await call_next(request)
        finally:
            current_session.reset(token)

    @app.exception_handler(NotReady)
    async def _not_ready(request: Request, exc: NotReady):
        return JSONResponse(status_code=503, content={"detail": str(exc), "code": "not_ready"})

    from .routers import (
        areas,
        assistant,
        gaps,
        judgments,
        maps,
        papers,
        plans,
        projects,
        search,
        settings,
        system,
        topics,
    )

    for r in (system, search, papers, topics, gaps, plans, projects, areas, maps, settings, judgments, assistant):
        app.include_router(r.router, prefix="/api")
    return app
