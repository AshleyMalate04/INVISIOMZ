"""Logs estruturados (JSON). Regra: nunca registar senhas, mensagens, nomes de ficheiros nem bytes."""

from __future__ import annotations

import contextvars
import json
import logging
import sys
from datetime import datetime, timezone

correlation_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("correlation_id", default="-")

# Campos permitidos nos logs (lista branca): só números/estados/códigos, nunca conteúdo.
_ALLOWED_EXTRA = {"event", "method", "path", "status", "duration_ms", "code", "bits", "width", "height",
                  "payload_bytes", "file_count", "has_message", "user_id", "detail"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "correlation_id": correlation_id_var.get(),
        }
        for key in _ALLOWED_EXTRA:
            if hasattr(record, key):
                payload[key] = getattr(record, key)
        if record.exc_info and record.exc_info[0] is not None:
            # Só o tipo da excepção: as mensagens podem conter dados do utilizador.
            payload["exc_type"] = record.exc_info[0].__name__
        return json.dumps(payload, ensure_ascii=False)


def setup_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    root.setLevel(level.upper())
    for h in list(root.handlers):
        if getattr(h, "_invisiomz", False):
            root.removeHandler(h)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    handler._invisiomz = True  # type: ignore[attr-defined]
    root.addHandler(handler)
    logging.getLogger("httpx").setLevel(logging.WARNING)  # os URLs do Supabase podem ter IDs
    logging.getLogger("multipart").setLevel(logging.WARNING)
    logging.getLogger("python_multipart").setLevel(logging.WARNING)
