"""Utilitários partilhados pelos routers."""

from __future__ import annotations

import logging

from fastapi import Request, UploadFile

from app.core.config import Settings
from app.core.errors import AppError
from app.services.history_service import HistoryService

log = logging.getLogger("invisiomz.api")


def settings_of(request: Request) -> Settings:
    return request.app.state.settings


def history_of(request: Request) -> HistoryService | None:
    return request.app.state.history


def require_history(request: Request) -> HistoryService:
    history = history_of(request)
    if history is None:
        raise AppError("SERVICE_UNAVAILABLE", "As contas e o histórico não estão disponíveis neste ambiente.")
    return history


async def read_upload(upload: UploadFile, limit: int, what: str = "ficheiro") -> bytes:
    """Lê o ficheiro em blocos e aborta ao ultrapassar `limit` (nunca lê tudo para depois verificar)."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise AppError("FILE_TOO_LARGE", f"O {what} excede o limite de {limit / (1024 * 1024):.0f} MB.")
        chunks.append(chunk)
    return b"".join(chunks)


async def safe_record(history: HistoryService | None, user_id: str | None, **fields) -> str | None:
    """Regista a operação (só metadados) para utilizadores autenticados; nunca faz falhar o pedido."""
    if history is None or user_id is None:
        return None
    try:
        return await history.record_operation(user_id=user_id, **fields)
    except AppError:
        log.warning("operation not recorded", extra={"event": "record_failed"})
        return None
