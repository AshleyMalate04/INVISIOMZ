from __future__ import annotations

from fastapi import APIRouter, Request

from app import __version__
from app.core.ratelimit import enforce
from app.schemas.models import ConfigOut, HealthOut, Limits

router = APIRouter(tags=["sistema"])


@router.get("/health", response_model=HealthOut)
async def health(request: Request) -> HealthOut:
    gateway = request.app.state.gateway
    if gateway is None:
        supabase = "not_configured"
    else:
        supabase = "ok" if await gateway.health() else "unavailable"
    return HealthOut(status="ok", version=__version__, supabase=supabase)


def limits_of(s) -> Limits:
    return Limits(
        max_image_bytes=s.max_image_bytes,
        max_image_pixels=s.max_image_pixels,
        max_files=s.max_files,
        max_file_bytes=s.max_file_bytes,
        max_total_bytes=s.max_total_bytes,
        max_message_chars=s.max_message_chars,
        password_min_length=s.password_min_length,
    )


@router.get("/config", response_model=ConfigOut)
async def public_config(request: Request) -> ConfigOut:
    """Limites e disponibilidade de contas — informação pública, sem segredos."""
    s = request.app.state.settings
    enforce(request, "general", s.rate_general_per_min)
    return ConfigOut(
        limits=limits_of(s),
        accounts_enabled=request.app.state.history is not None,
        guest_allowed=s.allow_guest,
        record_ttl_days=s.record_ttl_days,
        version=__version__,
    )
