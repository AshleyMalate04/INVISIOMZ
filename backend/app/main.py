"""Aplicação FastAPI do InvisioMZ."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.formparsers import MultiPartParser

from app import __version__
from app.api import capacity, extract, files, health, hide, history
from app.core.auth import JwtVerifier
from app.core.config import Settings, get_settings
from app.core.errors import AppError
from app.core.logging import correlation_id_var, setup_logging
from app.core.ratelimit import FailureTracker, SlidingWindowLimiter
from app.core.security import SecurityMiddleware
from app.services.download_store import DownloadStore
from app.services.history_service import HistoryService
from app.services.storage_service import StorageService
from app.services.supabase_gateway import SupabaseGateway

log = logging.getLogger("invisiomz")


async def _cleanup_loop(history: HistoryService, interval_s: int) -> None:
    """Tarefa agendada: apaga ficheiros e registos expirados (Storage + `stego_files`)."""
    while True:
        try:
            removed = await history.cleanup_expired()
            if removed:
                log.info("expired files removed", extra={"event": "cleanup", "detail": str(removed)})
        except AppError:
            log.warning("cleanup failed", extra={"event": "cleanup_failed"})
        await asyncio.sleep(interval_s)


def create_app(settings: Settings | None = None, gateway=None) -> FastAPI:
    s = settings or get_settings()
    setup_logging(s.log_level)

    # Anti decompression bomb + processamento em memória (o Starlette só passaria para disco acima disto).
    Image.MAX_IMAGE_PIXELS = s.max_image_pixels
    MultiPartParser.spool_max_size = s.max_request_bytes

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        task = None
        if app.state.history is not None and s.environment != "test":
            task = asyncio.create_task(_cleanup_loop(app.state.history, s.cleanup_interval_s))
        yield
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        if app.state.gateway is not None and hasattr(app.state.gateway, "aclose"):
            await app.state.gateway.aclose()

    app = FastAPI(
        title="InvisioMZ API",
        version=__version__,
        description="Esteganografia LSB + AES-256-GCM. Projecto académico de Segurança Informática.",
        docs_url="/docs" if s.docs_on else None,
        redoc_url=None,
        openapi_url="/openapi.json" if s.docs_on else None,
        lifespan=lifespan,
    )

    gw = gateway if gateway is not None else (SupabaseGateway(s) if s.supabase_configured else None)
    app.state.settings = s
    app.state.gateway = gw
    app.state.storage = StorageService(gw, s) if gw is not None else None
    app.state.history = HistoryService(gw, app.state.storage, s) if gw is not None else None
    app.state.verifier = JwtVerifier(s)
    app.state.limiter = SlidingWindowLimiter()
    app.state.failures = FailureTracker(s)
    app.state.jobs = asyncio.Semaphore(s.max_concurrent_jobs)  # limita a RAM usada em simultâneo
    app.state.downloads = DownloadStore(s.download_token_ttl_s, s.download_store_max_bytes)

    # O último adicionado é o mais externo: CORS por fora, para que também as respostas de erro o tenham.
    app.add_middleware(SecurityMiddleware, max_request_bytes=s.max_request_bytes, production=s.is_production)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.origins,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        expose_headers=hide.EXPOSED_HEADERS,
        allow_credentials=False,
        max_age=600,
    )

    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(exc.to_payload(correlation_id_var.get()), status_code=exc.status, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Nunca devolver `input` (pode conter a senha ou conteúdo): só localização e tipo do erro.
        problems = [{"field": ".".join(str(p) for p in e["loc"][1:]), "type": e["type"]} for e in exc.errors()]
        err = AppError("VALIDATION_ERROR", details={"fields": problems})
        return JSONResponse(err.to_payload(correlation_id_var.get()), status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND", 413: "FILE_TOO_LARGE", 429: "RATE_LIMITED"}.get(
            exc.status_code, "VALIDATION_ERROR" if exc.status_code < 500 else "INTERNAL_ERROR"
        )
        err = AppError(code, status=exc.status_code)
        return JSONResponse(err.to_payload(correlation_id_var.get()), status_code=exc.status_code, headers=getattr(exc, "headers", None))

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        log.error("unhandled error", exc_info=(type(exc), exc, None), extra={"event": "unhandled"})
        err = AppError("INTERNAL_ERROR")
        return JSONResponse(err.to_payload(correlation_id_var.get()), status_code=500)

    for module in (health, capacity, hide, extract, files, history):
        app.include_router(module.router, prefix="/api")
    return app


def _default_app() -> FastAPI:
    return create_app()


app = _default_app() if __name__ != "__main__" else None  # `uvicorn app.main:app`
