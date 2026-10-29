from __future__ import annotations

import json
import logging
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool

from app.api.deps import history_of, read_upload, safe_record, settings_of
from app.bundle.package import PackedFile
from app.core.auth import AuthUser, user_or_guest
from app.core.errors import AppError
from app.core.filenames import content_disposition
from app.core.ratelimit import enforce
from app.services import hide_service

router = APIRouter(tags=["ocultar"])
log = logging.getLogger("invisiomz.hide")

EXPOSED_HEADERS = [
    "Content-Disposition", "X-Request-ID", "X-Saved", "X-Output-Filename", "X-Image-Width", "X-Image-Height",
    "X-Original-Size", "X-Output-Size", "X-Output-Sha256", "X-Meta", "Retry-After",
]


def _meta(result: hide_service.HideResult) -> dict:
    return {
        "output_filename": result.output_filename,
        "width": result.width,
        "height": result.height,
        "original_format": result.original_format,
        "original_size_bytes": result.original_size_bytes,
        "output_size_bytes": result.output_size_bytes,
        "sha256": result.sha256,
        "bits": result.bits,
        "package_bytes": result.package_bytes,
        "useful_capacity_bytes": result.useful_capacity_bytes,
        "file_count": result.file_count,
        "has_message": result.has_message,
        "duration_ms": result.duration_ms,
        "warnings": result.warnings,
    }


@router.post("/hide")
async def hide(
    request: Request,
    image: UploadFile = File(...),
    password: str = Form(...),
    message: str | None = Form(None),
    bits: int = Form(1),
    save_to_history: bool = Form(False),
    label: str | None = Form(None),
    files: list[UploadFile] = File(default=[]),
    user: AuthUser | None = Depends(user_or_guest),
):
    s = settings_of(request)
    enforce(request, "hide", s.rate_hide_per_min)
    history = history_of(request)

    if save_to_history:
        if user is None:
            raise AppError("UNAUTHORIZED", "Entre na sua conta para guardar no histórico.")
        if history is None:
            raise AppError("SERVICE_UNAVAILABLE", "O histórico não está disponível neste ambiente.")
    if message is not None and len(message) > s.max_message_chars:
        raise AppError("FILE_TOO_LARGE", f"A mensagem excede {s.max_message_chars} caracteres.")
    if len(files) > s.max_files:
        raise AppError("FILE_TOO_LARGE", f"Máximo de {s.max_files} ficheiros por operação.")

    image_bytes = await read_upload(image, s.max_image_bytes, "ficheiro de imagem")
    packed: list[PackedFile] = []
    total = 0
    for f in files:
        data = await read_upload(f, s.max_file_bytes)
        total += len(data)
        if total > s.max_total_bytes:
            raise AppError("FILE_TOO_LARGE", "O tamanho total dos anexos excede o limite.")
        packed.append(PackedFile(name=f.filename or "ficheiro", data=data))

    try:
        async with request.app.state.jobs:
            result = await run_in_threadpool(
                hide_service.hide,
                image_bytes=image_bytes,
                image_name=image.filename,
                message=message,
                files=packed,
                password=password,
                bits=bits,
                settings=s,
            )
    except AppError as exc:
        if user is not None:
            await safe_record(history, user.id, type="hide", status="failed", error_code=exc.code, bits=bits,
                              file_count=len(packed), has_message=bool(message and message.strip()))
        raise

    op_id = await safe_record(
        history, user.id if user else None, type="hide", status="success", bits=result.bits,
        width=result.width, height=result.height, payload_bytes=result.package_bytes,
        file_count=result.file_count, has_message=result.has_message, duration_ms=result.duration_ms,
    )
    log.info("hide ok", extra={"event": "hide_ok", "bits": result.bits, "width": result.width, "height": result.height,
                               "payload_bytes": result.package_bytes, "file_count": result.file_count,
                               "duration_ms": result.duration_ms})

    meta = _meta(result)
    saved_headers = {"X-Saved": "false"}
    if save_to_history and user is not None and history is not None and op_id is not None:
        try:
            saved = await history.save_result(
                user_id=user.id, operation_id=op_id, png=result.png, sha256=result.sha256,
                label=(label or "").strip()[:80] or None,
            )
            return JSONResponse(
                {"saved": True, "operation_id": op_id, "signed_url": saved["signed_url"],
                 "expires_at": saved["expires_at"], "meta": meta},
                headers={"X-Output-Filename": quote(result.output_filename)},
            )
        except AppError:
            log.warning("save failed", extra={"event": "save_failed"})
            saved_headers["X-Save-Error"] = "1"  # devolve o PNG na mesma: o trabalho do utilizador não se perde

    headers = {
        "Content-Disposition": content_disposition(result.output_filename),
        "X-Output-Filename": quote(result.output_filename),
        "X-Image-Width": str(result.width),
        "X-Image-Height": str(result.height),
        "X-Original-Size": str(result.original_size_bytes),
        "X-Output-Size": str(result.output_size_bytes),
        "X-Output-Sha256": result.sha256,
        "X-Meta": quote(json.dumps(meta, ensure_ascii=False, separators=(",", ":"))),
        **saved_headers,
    }
    return Response(content=result.png, media_type="image/png", headers=headers)
