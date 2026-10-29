"""Ocultar: imagem + mensagem/ficheiros + senha -> PNG esteganográfico (tudo em memória)."""

from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass, field

import numpy as np

from app.bundle.package import PackedFile, build_package
from app.core.config import Settings
from app.core.errors import AppError
from app.core.filenames import make_output_name
from app.crypto.kdf import KdfParams
from app.steganography import capacity, envelope, image_io, lsb


@dataclass
class HideResult:
    png: bytes
    output_filename: str
    width: int
    height: int
    original_format: str
    original_size_bytes: int
    output_size_bytes: int
    sha256: str
    bits: int
    package_bytes: int
    useful_capacity_bytes: int
    file_count: int
    has_message: bool
    duration_ms: int
    warnings: list[str] = field(default_factory=list)


def validate_password(password: str, settings: Settings) -> None:
    if len(password) < settings.password_min_length:
        raise AppError("WEAK_PASSWORD", f"A senha deve ter pelo menos {settings.password_min_length} caracteres.")


def hide(
    *,
    image_bytes: bytes,
    image_name: str | None,
    message: str | None,
    files: list[PackedFile],
    password: str,
    bits: int,
    settings: Settings,
) -> HideResult:
    started = time.perf_counter()
    if bits not in capacity.VALID_BITS:
        raise AppError("VALIDATION_ERROR", "O modo de bits deve ser 1 ou 2.")
    validate_password(password, settings)
    message = message if message and message.strip() else None
    if message is None and not files:
        raise AppError("EMPTY_PAYLOAD")

    loaded = image_io.load_image(image_bytes, max_pixels=settings.max_image_pixels, for_embedding=True)
    package = build_package(message, files)

    useful = capacity.useful_capacity_bytes(loaded.width, loaded.height, bits)
    if len(package) > useful:
        raise AppError(
            "CAPACITY_EXCEEDED",
            (
                f"O conteúdo ({len(package):,} B com sobrecarga) não cabe nesta imagem "
                f"(capacidade útil: {useful:,} B no modo de {bits} bit{'s' if bits > 1 else ''}). "
                "Use uma imagem maior"
                + (" ou o modo de 2 bits." if bits == 1 else ".")
            ).replace(",", " "),
            details={"needed_bytes": len(package), "useful_capacity_bytes": useful, "bits": bits},
        )

    params = KdfParams(settings.scrypt_log2n, settings.scrypt_r, settings.scrypt_p)
    sealed = envelope.seal(package, password, bits, params)
    header_bytes = sealed.header.pack()
    perm = lsb.permutation(lsb.slots_available(loaded.rgb), sealed.keys.perm_key)  # a parte mais cara: calcula-se uma vez
    stego_rgb = lsb.embed(loaded.rgb, header_bytes, sealed.ciphertext, bits, sealed.keys.perm_key, perm)
    png = image_io.encode_png(stego_rgb, loaded.alpha)
    del stego_rgb

    _verify_round_trip(png, header_bytes, sealed, package, bits, perm, settings)

    return HideResult(
        png=png,
        output_filename=make_output_name(image_name),
        width=loaded.width,
        height=loaded.height,
        original_format=loaded.format,
        original_size_bytes=loaded.size_bytes,
        output_size_bytes=len(png),
        sha256=hashlib.sha256(png).hexdigest(),
        bits=bits,
        package_bytes=len(package),
        useful_capacity_bytes=useful,
        file_count=len(files),
        has_message=message is not None,
        duration_ms=int((time.perf_counter() - started) * 1000),
        warnings=loaded.warnings,
    )


def _verify_round_trip(
    png: bytes, header_bytes: bytes, sealed: envelope.Sealed, package: bytes, bits: int, perm, settings: Settings
) -> None:
    """Relê o PNG gerado (descodificado de novo a partir dos bytes) e confirma cabeçalho, corpo cifrado e decifra.

    Reutiliza a permutação (já testada à parte) para não pagar o seu custo duas vezes; o que se verifica aqui é a
    codificação/descodificação do PNG, a escrita dos bits e a tag AES-GCM.
    """
    check = image_io.load_image(png, max_pixels=settings.max_image_pixels, for_embedding=False)
    ok = np.array_equal(
        np.frombuffer(lsb.read_header_bytes(check.rgb), dtype=np.uint8), np.frombuffer(header_bytes, dtype=np.uint8)
    )
    if ok:
        body = lsb.read_body(check.rgb, len(sealed.ciphertext), bits, sealed.keys.perm_key, perm)
        ok = body == sealed.ciphertext and envelope.open_envelope(sealed.header, body, sealed.keys) == package
    if not ok:
        raise AppError("INTERNAL_ERROR", "A verificação pós-escrita falhou; o resultado foi descartado.")
