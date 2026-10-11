"""Nebiru's backend: the app's writing and illustration services over HTTP.

Run from the server folder:  .venv/bin/uvicorn app.main:app --port 8787
"""

from __future__ import annotations

import time
import uuid
from contextlib import asynccontextmanager
from typing import AsyncIterator

import httpx
from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .comfy import ComfyUI
from .config import Settings, load_settings
from .deepseek import DeepSeek
from .errors import ServiceError
from .schemas import (
    BookPlan,
    ChapterDraft,
    ChapterRequest,
    ChatRequest,
    ChatResponse,
    IllustrationPromptsRequest,
    IllustrationPromptsResponse,
    IllustrationRequest,
    IllustrationResponse,
    OutlineRequest,
    OutlineResponse,
    PlanRequest,
    ReviseRequest,
    ReviseResponse,
    ServiceState,
    Status,
)
from .text_service import TextService

BALANCE_CACHE_S = 120.0


class Services:
    """Everything a request needs, built once when the server starts."""

    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self.settings = settings
        self.deepseek = DeepSeek(settings, client)
        self.text = TextService(self.deepseek, settings)
        self.comfy = ComfyUI(settings, client)
        self._balance: tuple[float, str] | None = None

    async def text_state(self) -> ServiceState:
        problem = self.settings.text_problem
        if problem:
            return ServiceState(available=False, detail=problem)
        return ServiceState(available=True, detail=await self._balance_warning())

    async def _balance_warning(self) -> str:
        """A warning when the account cannot pay for requests, checked at most every two minutes.

        An empty account does not make the service "unavailable": requests still go to
        DeepSeek and fail with its own error, rather than quietly falling back to stand-ins.
        """
        now = time.monotonic()
        if self._balance and now - self._balance[0] < BALANCE_CACHE_S:
            return self._balance[1]
        try:
            balance = await self.deepseek.balance()
            warning = "" if balance.get("is_available", True) else "The DeepSeek account has no balance left."
        except ServiceError as error:
            warning = error.message
        self._balance = (now, warning)
        return warning

    async def illustration_state(self) -> ServiceState:
        problem = await self.comfy.problem()
        return ServiceState(available=problem is None, detail=problem or "")


def create_app(settings: Settings | None = None, transport: httpx.AsyncBaseTransport | None = None) -> FastAPI:
    """Build the app. Tests pass their own settings and a fake HTTP transport."""
    settings = settings or load_settings()
    settings.images_dir.mkdir(parents=True, exist_ok=True)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        async with httpx.AsyncClient(transport=transport) as client:
            app.state.services = Services(settings, client)
            yield

    app = FastAPI(title="Nebiru", lifespan=lifespan)

    @app.exception_handler(ServiceError)
    async def service_error(_: Request, error: ServiceError) -> JSONResponse:
        return JSONResponse(status_code=error.status, content={"detail": error.message})

    def services(request: Request) -> Services:
        return request.app.state.services

    api = APIRouter(prefix="/api")

    @api.get("/status", response_model=Status)
    async def status(request: Request) -> Status:
        svc = services(request)
        return Status(text=await svc.text_state(), illustration=await svc.illustration_state())

    @api.post("/text/plan", response_model=BookPlan)
    async def plan(body: PlanRequest, request: Request) -> BookPlan:
        return await services(request).text.plan(body)

    @api.post("/text/outline", response_model=OutlineResponse)
    async def outline(body: OutlineRequest, request: Request) -> OutlineResponse:
        return await services(request).text.revise_outline(body)

    @api.post("/text/chapter", response_model=ChapterDraft)
    async def chapter(body: ChapterRequest, request: Request) -> ChapterDraft:
        return await services(request).text.write_chapter(body)

    @api.post("/text/illustration-prompts", response_model=IllustrationPromptsResponse)
    async def illustration_prompts(body: IllustrationPromptsRequest, request: Request) -> IllustrationPromptsResponse:
        return await services(request).text.illustration_prompts(body)

    @api.post("/text/revise", response_model=ReviseResponse)
    async def revise(body: ReviseRequest, request: Request) -> ReviseResponse:
        return await services(request).text.revise(body)

    @api.post("/text/chat", response_model=ChatResponse)
    async def chat(body: ChatRequest, request: Request) -> ChatResponse:
        return await services(request).text.chat(body)

    @api.post("/illustrations", response_model=IllustrationResponse)
    async def illustrate(body: IllustrationRequest, request: Request) -> IllustrationResponse:
        image, seed = await services(request).comfy.generate(body)
        name = f"{uuid.uuid4().hex}.png"
        (settings.images_dir / name).write_bytes(image)
        return IllustrationResponse(src=f"/api/images/{name}", seed=seed)

    app.include_router(api)
    app.mount("/api/images", StaticFiles(directory=settings.images_dir), name="images")
    return app


app = create_app()
