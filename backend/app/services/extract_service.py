"""Extrair: PNG + senha -> mensagem e ficheiros (só depois de a tag AES-GCM autenticar)."""

from __future__ import annotations

import time
from dataclasses import dataclass

from app.bundle.package import ExtractedFile, parse_package
from app.core.config import Settings
from app.core.errors import AppError
from app.crypto import kdf
from app.steganography import envelope, image_io, lsb


@dataclass
class ExtractResult:
    message: str | None
    files: list[ExtractedFile]
    bits: int
    width: int
    height: int
    payload_bytes: int
    duration_ms: int


def extract(*, image_bytes: bytes, password: str, settings: Settings) -> ExtractResult:
    started = time.perf_counter()
    if not password:
        raise AppError("VALIDATION_ERROR", "Indique a senha.")
    loaded = image_io.load_image(image_bytes, max_pixels=settings.max_image_pixels, for_embedding=False)

    header = envelope.parse_header(lsb.read_header_bytes(loaded.rgb))
    # Comprimentos validados ANTES de alocar o que quer que seja (cabeçalho pode ser malicioso).
    max_ct = settings.max_total_bytes + settings.max_message_chars * 4 + 1024 * 1024
    if header.ct_len > max_ct:
        raise AppError("CORRUPTED_IMAGE", "O comprimento declarado dos dados escondidos é inválido.")
    if lsb.slots_available(loaded.rgb) * header.bits < header.ct_len * 8:
        raise AppError("TRUNCATED_PAYLOAD")

    keys = kdf.derive_keys(password, header.salt, header.kdf_params)
    body = lsb.read_body(loaded.rgb, header.ct_len, header.bits, keys.perm_key)
    package_bytes = envelope.open_envelope(header, body, keys)  # AppError WRONG_PASSWORD_OR_TAMPERED se falhar

    package = parse_package(
        package_bytes,
        max_files=settings.max_files,
        max_total_bytes=settings.max_total_bytes,
    )
    return ExtractResult(
        message=package.message,
        files=package.files,
        bits=header.bits,
        width=loaded.width,
        height=loaded.height,
        payload_bytes=len(package_bytes),
        duration_ms=int((time.perf_counter() - started) * 1000),
    )
