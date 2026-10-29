"""Middleware: ID de correlação, limite de tamanho do pedido, cabeçalhos de segurança, log de pedidos."""

from __future__ import annotations

import logging
import time
import uuid

from fastapi import HTTPException
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.errors import AppError
from app.core.logging import correlation_id_var

log = logging.getLogger("invisiomz.http")

_API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
_DOCS_CSP = (
    "default-src 'self'; img-src 'self' data: https://fastapi.tiangolo.com; "
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; frame-ancestors 'none'"
)
_DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")


def _json_error_body(error: AppError, correlation_id: str) -> bytes:
    import json

    return json.dumps(error.to_payload(correlation_id), ensure_ascii=False).encode("utf-8")


class SecurityMiddleware:
    """ASGI puro (não bufferiza respostas): correlação, limite de corpo, cabeçalhos, log."""

    def __init__(self, app: ASGIApp, *, max_request_bytes: int, production: bool) -> None:
        self.app = app
        self.max_request_bytes = max_request_bytes
        self.production = production

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        cid = uuid.uuid4().hex[:16]
        token = correlation_id_var.set(cid)
        started = time.perf_counter()
        path = scope.get("path", "")
        status_holder = {"status": 500}
        limit = self.max_request_bytes

        # 1) Limite de tamanho: pelo Content-Length e, se faltar, contando bytes recebidos.
        declared = None
        for name, value in scope.get("headers", []):
            if name == b"content-length":
                try:
                    declared = int(value)
                except ValueError:
                    declared = None
        if declared is not None and declared > limit:
            await self._reject(send, AppError("FILE_TOO_LARGE", "O pedido excede o tamanho máximo permitido."), cid, path)
            correlation_id_var.reset(token)
            return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    # HTTPException (e não AppError): o FastAPI converte outras excepções em 400 ao ler o corpo.
                    raise HTTPException(status_code=413, detail="request too large")
            return message

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                headers = MutableHeaders(scope=message)
                headers["X-Request-ID"] = cid
                headers["X-Content-Type-Options"] = "nosniff"
                headers["Referrer-Policy"] = "no-referrer"
                headers["X-Frame-Options"] = "DENY"
                headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
                headers["Content-Security-Policy"] = _DOCS_CSP if path.startswith(_DOCS_PATHS) else _API_CSP
                if path.startswith("/api") and "cache-control" not in headers:
                    headers["Cache-Control"] = "no-store"
                if self.production:
                    headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
            await send(message)

        try:
            await self.app(scope, limited_receive, send_wrapper)
        finally:
            log.info(
                "request",
                extra={
                    "event": "http_request",
                    "method": scope.get("method"),
                    "path": path,
                    "status": status_holder["status"],
                    "duration_ms": int((time.perf_counter() - started) * 1000),
                },
            )
            correlation_id_var.reset(token)

    @staticmethod
    async def _reject(send: Send, error: AppError, cid: str, path: str) -> None:
        body = _json_error_body(error, cid)
        await send(
            {
                "type": "http.response.start",
                "status": error.status,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                    (b"x-request-id", cid.encode()),
                    (b"x-content-type-options", b"nosniff"),
                    (b"cache-control", b"no-store"),
                    (b"connection", b"close"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
        log.info(
            "request rejected",
            extra={"event": "http_request", "path": path, "status": error.status, "code": error.code},
        )
