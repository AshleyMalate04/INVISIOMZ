"""Validação dos JWT do Supabase: assinatura, expiração e audiência (nunca se confia no cliente)."""

from __future__ import annotations

from dataclasses import dataclass

import jwt
from fastapi import Request
from jwt import PyJWKClient

from app.core.config import Settings
from app.core.errors import AppError

_HS_ALGS = {"HS256"}
_ASYM_ALGS = ["ES256", "RS256", "EdDSA"]
AUDIENCE = "authenticated"


@dataclass(frozen=True)
class AuthUser:
    id: str
    email: str | None
    token: str


class JwtVerifier:
    def __init__(self, settings: Settings) -> None:
        self._secret = settings.supabase_jwt_secret
        self._issuer = f"{settings.supabase_url.rstrip('/')}/auth/v1" if settings.supabase_url else None
        self._jwks = (
            PyJWKClient(f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json", cache_keys=True, lifespan=600)
            if settings.supabase_url
            else None
        )

    @property
    def available(self) -> bool:
        return bool(self._secret or self._jwks)

    def verify(self, token: str) -> AuthUser:
        try:
            alg = jwt.get_unverified_header(token).get("alg", "")
            if alg in _HS_ALGS:
                if not self._secret:
                    raise AppError("UNAUTHORIZED")
                claims = jwt.decode(
                    token, self._secret, algorithms=list(_HS_ALGS), audience=AUDIENCE,
                    options={"require": ["exp", "sub", "aud"]},
                )
            elif alg in _ASYM_ALGS:
                if not self._jwks:
                    raise AppError("UNAUTHORIZED")
                key = self._jwks.get_signing_key_from_jwt(token).key
                claims = jwt.decode(
                    token, key, algorithms=_ASYM_ALGS, audience=AUDIENCE,
                    options={"require": ["exp", "sub", "aud"]},
                )
            else:  # inclui "none"
                raise AppError("UNAUTHORIZED")
        except AppError:
            raise
        except Exception:  # assinatura, expiração, audiência, JWKS indisponível…
            raise AppError("UNAUTHORIZED") from None
        if claims.get("role") not in (None, "authenticated"):
            raise AppError("UNAUTHORIZED")
        return AuthUser(id=str(claims["sub"]), email=claims.get("email"), token=token)


def _bearer(request: Request) -> str | None:
    header = request.headers.get("authorization")
    if not header:
        return None
    scheme, _, value = header.partition(" ")
    if scheme.lower() != "bearer" or not value.strip():
        raise AppError("UNAUTHORIZED")
    return value.strip()


async def optional_user(request: Request) -> AuthUser | None:
    """Convidado (sem cabeçalho) -> None. Cabeçalho presente mas inválido/expirado -> 401."""
    token = _bearer(request)
    if token is None:
        return None
    verifier: JwtVerifier = request.app.state.verifier
    return verifier.verify(token)


async def user_or_guest(request: Request) -> AuthUser | None:
    """Ocultar/extrair: exige sessão, excepto se `ALLOW_GUEST=true` (modo convidado, desligado por defeito)."""
    user = await optional_user(request)
    if user is None and not request.app.state.settings.allow_guest:
        raise AppError("UNAUTHORIZED", "Inicie sessão para usar o InvisioMZ.")
    return user


async def require_user(request: Request) -> AuthUser:
    token = _bearer(request)
    if token is None:
        raise AppError("UNAUTHORIZED")
    verifier: JwtVerifier = request.app.state.verifier
    return verifier.verify(token)
