from __future__ import annotations

import base64
import logging

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from starlette.concurrency import run_in_threadpool

from app.api.deps import history_of, read_upload, safe_record, settings_of
from app.bundle.package import build_download_zip
from app.core.auth import AuthUser, user_or_guest
from app.core.errors import AppError
from app.core.ratelimit import enforce, hash_ip
from app.schemas.models import ExtractedFileOut, ExtractOut
from app.services import extract_service

router = APIRouter(tags=["extrair"])
log = logging.getLogger("invisiomz.extract")

# Códigos que contam como «tentativa de senha falhada» para o backoff
_PASSWORD_FAILURES = {"WRONG_PASSWORD_OR_TAMPERED"}


@router.post("/extract", response_model=ExtractOut)
async def extract(
    request: Request,
    image: UploadFile = File(...),
    password: str = Form(...),
    user: AuthUser | None = Depends(user_or_guest),
) -> ExtractOut:
    s = settings_of(request)
    ip = enforce(request, "extract", s.rate_extract_per_min)
    tracker = request.app.state.failures
    tracker.check(ip)
    history = history_of(request)
    ip_hash = hash_ip(ip, s.ip_hash_salt)

    image_bytes = await read_upload(image, s.max_image_bytes, "ficheiro de imagem")
    try:
        async with request.app.state.jobs:
            result = await run_in_threadpool(extract_service.extract, image_bytes=image_bytes, password=password, settings=s)
    except AppError as exc:
        if exc.code in _PASSWORD_FAILURES:
            tracker.record_failure(ip)
        if history is not None and exc.code in _PASSWORD_FAILURES | {"CORRUPTED_IMAGE", "ATTACHMENT_RECOVERY_FAILED"}:
            await history.audit(f"extract_failed:{exc.code}", user.id if user else None, ip_hash)
        if user is not None:
            await safe_record(history, user.id, type="extract", status="failed", error_code=exc.code)
        raise
    tracker.record_success(ip)

    await safe_record(
        history, user.id if user else None, type="extract", status="success", bits=result.bits,
        width=result.width, height=result.height, payload_bytes=result.payload_bytes,
        file_count=len(result.files), has_message=result.message is not None, duration_ms=result.duration_ms,
    )
    log.info("extract ok", extra={"event": "extract_ok", "bits": result.bits, "width": result.width,
                                  "height": result.height, "payload_bytes": result.payload_bytes,
                                  "file_count": len(result.files), "duration_ms": result.duration_ms})

    store = request.app.state.downloads
    total = sum(f.size for f in result.files)
    inline = total <= s.extract_inline_max_bytes
    zip_token = None
    out_files: list[ExtractedFileOut] = []

    if result.files:
        zip_bytes = build_download_zip(result.message, result.files)
        zip_token = store.put(zip_bytes, "invisiomz_ficheiros.zip", "application/zip")
        if zip_token is None and not inline:
            raise AppError("SERVICE_UNAVAILABLE", "Armazém temporário de descargas cheio. Tente de novo dentro de instantes.")
    for f in result.files:
        entry = ExtractedFileOut(id=f.id, name=f.name, size=f.size, sha256=f.sha256, mime=f.mime)
        if inline:
            entry.content_b64 = base64.b64encode(f.data).decode("ascii")
        else:
            token = store.put(f.data, f.name, "application/octet-stream")
            if token is None:
                raise AppError("SERVICE_UNAVAILABLE", "Armazém temporário de descargas cheio. Tente de novo dentro de instantes.")
            entry.download_token = token
        out_files.append(entry)

    return ExtractOut(
        message=result.message,
        files=out_files,
        zip_token=zip_token,
        inline=inline,
        total_bytes=total,
        bits=result.bits,
        width=result.width,
        height=result.height,
        duration_ms=result.duration_ms,
        token_ttl_s=s.download_token_ttl_s,
    )
