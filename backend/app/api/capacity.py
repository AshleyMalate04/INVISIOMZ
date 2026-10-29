from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from starlette.concurrency import run_in_threadpool

from app.api.deps import read_upload, settings_of
from app.api.health import limits_of
from app.core.auth import AuthUser, user_or_guest
from app.core.errors import AppError
from app.core.ratelimit import enforce
from app.schemas.models import CapacityOut, ModeCapacity, Overhead
from app.steganography import capacity, image_io
from app.steganography.envelope import HEADER_LEN

router = APIRouter(tags=["capacidade"])


@router.post("/capacity", response_model=CapacityOut)
async def get_capacity(
    request: Request,
    image: UploadFile = File(...),
    bits: int = Form(1),
    _user: AuthUser | None = Depends(user_or_guest),
) -> CapacityOut:
    s = settings_of(request)
    enforce(request, "general", s.rate_general_per_min)
    if bits not in capacity.VALID_BITS:
        raise AppError("VALIDATION_ERROR", "O modo de bits deve ser 1 ou 2.")
    data = await read_upload(image, s.max_image_bytes, "ficheiro de imagem")
    async with request.app.state.jobs:
        loaded = await run_in_threadpool(
            image_io.load_image, data, max_pixels=s.max_image_pixels, for_embedding=True
        )
    modes = {
        str(b): ModeCapacity(
            raw_capacity_bytes=capacity.raw_capacity_bytes(loaded.width, loaded.height, b),
            useful_capacity_bytes=capacity.useful_capacity_bytes(loaded.width, loaded.height, b),
        )
        for b in capacity.VALID_BITS
    }
    return CapacityOut(
        width=loaded.width,
        height=loaded.height,
        format=loaded.format,
        original_size_bytes=loaded.size_bytes,
        warnings=loaded.warnings,
        bits=bits,
        raw_capacity_bytes=modes[str(bits)].raw_capacity_bytes,
        useful_capacity_bytes=modes[str(bits)].useful_capacity_bytes,
        modes=modes,
        overhead=Overhead(
            header_bytes=HEADER_LEN,
            aead_tag_bytes=16,
            fixed_bytes=capacity.fixed_overhead_bytes(),
            per_file_bytes=capacity.per_file_overhead_bytes(),
        ),
        limits=limits_of(s),
    )
