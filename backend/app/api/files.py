from __future__ import annotations

from fastapi import APIRouter, Request, Response

from app.api.deps import settings_of
from app.core.errors import AppError
from app.core.filenames import content_disposition
from app.core.ratelimit import enforce

router = APIRouter(tags=["ficheiros"])


@router.get("/files/{token}")
async def download(token: str, request: Request) -> Response:
    """Descarga de uso único (token aleatório, validade curta). Servida sempre como anexo opaco."""
    s = settings_of(request)
    enforce(request, "general", s.rate_general_per_min)
    if len(token) > 128:
        raise AppError("NOT_FOUND")
    entry = request.app.state.downloads.take(token)
    if entry is None:
        raise AppError("NOT_FOUND", "Esta ligação de descarga expirou ou já foi utilizada. Extraia de novo.")
    media = "application/zip" if entry.content_type == "application/zip" else "application/octet-stream"
    return Response(
        content=entry.data,
        media_type=media,
        headers={"Content-Disposition": content_disposition(entry.filename), "Cache-Control": "no-store"},
    )
