"""Nebiru's backend: the app's writing and illustration services over HTTP.

Run from the server folder:  .venv/bin/uvicorn app.main:app --port 8787
"""

from __future__ import annotations

import time
import uuid
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

import httpx
from fastapi import APIRouter, Body, FastAPI, Request
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException
from starlette.types import Scope

from .comfy import ComfyUI
from .config import Settings, load_settings
from .deepseek import DeepSeek
from .downloads import download_message
from .errors import ServiceError
from .library import Library
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
    PageText,
    PlanRequest,
    ReviseRequest,
    ReviseResponse,
    ServiceState,
    Status,
)
from .text_service import TextService
from .vision import read_page

BALANCE_CACHE_S = 120.0


class WebApp(StaticFiles):
    """Serves the built web app, answering any unknown page address with the app itself.

    The app routes in the browser (/book/abc is not a file), so a reload on any of its
    pages must return index.html. Addresses under /api never fall through to it.
    """

    async def get_response(self, path: str, scope: Scope) -> Response:
        try:
            return await super().get_response(path, scope)
        except HTTPException as error:
            if error.status_code != 404 or path.startswith("api/") or path == "api":
                raise
            return await super().get_response("index.html", scope)


class Services:
    """Everything a request needs, built once when the server starts."""

    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self.settings = settings
        self.deepseek = DeepSeek(settings, client)
        self.text = TextService(self.deepseek, settings)
        self.comfy = ComfyUI(settings, client)
        self.library = Library(settings.books_dir)
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
        if problem is None:
            return ServiceState(available=True)
        # While the models are still arriving, say that rather than "not reachable".
        return ServiceState(available=False, detail=download_message(self.settings.model_status_file) or problem)


def create_app(settings: Settings | None = None, transport: httpx.AsyncBaseTransport | None = None) -> FastAPI:
    """Build the app. Tests pass their own settings and a fake HTTP transport."""
    settings = settings or load_settings()
    settings.images_dir.mkdir(parents=True, exist_ok=True)
    settings.books_dir.mkdir(parents=True, exist_ok=True)

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

    @api.get("/health")
    async def health() -> dict[str, bool]:
        return {"ok": True}

    @api.get("/books")
    async def list_books(request: Request) -> dict[str, list[dict[str, Any]]]:
        return {"books": services(request).library.all()}

    @api.put("/books/{book_id}")
    async def save_book(book_id: str, request: Request, book: dict[str, Any] = Body(...)) -> dict[str, bool]:
        services(request).library.save(book_id, book)
        return {"ok": True}

    @api.delete("/books/{book_id}")
    async def delete_book(book_id: str, request: Request) -> dict[str, bool]:
        services(request).library.delete(book_id)
        return {"ok": True}

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

    @api.post("/import/image", response_model=PageText)
    async def import_image(request: Request) -> PageText:
        """Read the text of a page image. The request body is the image file itself."""
        title, paragraphs = await read_page(services(request).deepseek, await request.body())
        return PageText(title=title, paragraphs=paragraphs)

    @api.post("/illustrations", response_model=IllustrationResponse)
    async def illustrate(body: IllustrationRequest, request: Request) -> IllustrationResponse:
        image, seed = await services(request).comfy.generate(body)
        name = f"{uuid.uuid4().hex}.png"
        (settings.images_dir / name).write_bytes(image)
        return IllustrationResponse(src=f"/api/images/{name}", seed=seed)

    app.include_router(api)
    app.mount("/api/images", StaticFiles(directory=settings.images_dir), name="images")
    if settings.static_dir and settings.static_dir.is_dir():
        app.mount("/", WebApp(directory=settings.static_dir, html=True), name="web")
    return app


app = create_app()
