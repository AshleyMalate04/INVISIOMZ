"""Rate limiting em memória (janela deslizante) e backoff após falhas de extracção.

Funciona por processo: para vários *workers* seria necessário um armazenamento partilhado (Redis).
Documentado em docs/DECISOES.md.
"""

from __future__ import annotations

import hashlib
import threading
import time
from collections import defaultdict, deque

from fastapi import Request

from app.core.config import Settings
from app.core.errors import AppError


def client_ip(request: Request, trust_proxy: bool, hops: int = 1) -> str:
    """IP do cliente. Atrás de proxies de confiança lê-se o `X-Forwarded-For` **a contar da direita**:
    cada proxy acrescenta ao fim o IP de quem lhe ligou, por isso a entrada `hops` posições antes do fim é a
    última que um proxy nosso viu. A parte da esquerda pode ser inventada pelo cliente e é ignorada
    (senão bastaria enviar `X-Forwarded-For: 1.2.3.4` para fugir ao rate limiting)."""
    if trust_proxy:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            parts = [p.strip() for p in fwd.split(",") if p.strip()]
            if parts:
                return parts[-hops] if len(parts) >= hops else parts[0]
    return request.client.host if request.client else "unknown"


def hash_ip(ip: str, salt: str) -> str:
    """Hash com sal (nunca se guarda o IP em claro)."""
    return hashlib.sha256(f"{salt}:{ip}".encode()).hexdigest()[:32]


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window_s: float = 60.0) -> None:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > window_s:
                q.popleft()
            if len(q) >= limit:
                retry = max(1, int(window_s - (now - q[0])) + 1)
                raise AppError("RATE_LIMITED", headers={"Retry-After": str(retry)})
            q.append(now)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


class FailureTracker:
    """Backoff exponencial por IP após falhas repetidas de senha (anti força-bruta)."""

    def __init__(self, settings: Settings) -> None:
        self._s = settings
        self._fails: dict[str, deque[float]] = defaultdict(deque)
        self._locked_until: dict[str, float] = {}
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            until = self._locked_until.get(key, 0.0)
            if until > now:
                raise AppError(
                    "RATE_LIMITED",
                    "Demasiadas tentativas falhadas. Aguarde antes de tentar de novo.",
                    headers={"Retry-After": str(int(until - now) + 1)},
                )

    def record_failure(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            q = self._fails[key]
            q.append(now)
            while q and now - q[0] > self._s.extract_fail_window_s:
                q.popleft()
            over = len(q) - self._s.extract_fail_threshold
            if over >= 0:
                delay = min(self._s.extract_lock_base_s * (2**over), self._s.extract_lock_max_s)
                self._locked_until[key] = now + delay

    def record_success(self, key: str) -> None:
        with self._lock:
            self._fails.pop(key, None)
            self._locked_until.pop(key, None)

    def reset(self) -> None:
        with self._lock:
            self._fails.clear()
            self._locked_until.clear()


def enforce(request: Request, bucket: str, per_min: int) -> str:
    """Aplica o limite por IP ao balde indicado; devolve o IP (para auditoria/backoff)."""
    s: Settings = request.app.state.settings
    ip = client_ip(request, s.trust_proxy_headers, s.proxy_hops)
    if s.rate_limit_enabled:
        limiter: SlidingWindowLimiter = request.app.state.limiter
        limiter.check(f"{bucket}:{ip}", per_min)
    return ip
