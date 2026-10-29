"""Armazém em memória de descargas temporárias: tokens aleatórios, validade curta e USO ÚNICO.

Os bytes extraídos nunca vão para disco nem para o Supabase.
"""

from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass


@dataclass
class _Entry:
    data: bytes
    filename: str
    content_type: str
    expires: float


class DownloadStore:
    def __init__(self, ttl_s: int, max_bytes: int) -> None:
        self._ttl = ttl_s
        self._max = max_bytes
        self._items: dict[str, _Entry] = {}
        self._lock = threading.Lock()

    def _purge(self, now: float) -> None:
        for token in [t for t, e in self._items.items() if e.expires <= now]:
            del self._items[token]

    def _size(self) -> int:
        return sum(len(e.data) for e in self._items.values())

    def put(self, data: bytes, filename: str, content_type: str) -> str | None:
        """Devolve o token, ou None se o armazém estiver cheio."""
        now = time.monotonic()
        with self._lock:
            self._purge(now)
            if self._size() + len(data) > self._max:
                return None
            token = secrets.token_urlsafe(32)
            self._items[token] = _Entry(data, filename, content_type, now + self._ttl)
            return token

    def take(self, token: str) -> _Entry | None:
        """Devolve e REMOVE a entrada (uso único)."""
        now = time.monotonic()
        with self._lock:
            self._purge(now)
            return self._items.pop(token, None)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()
