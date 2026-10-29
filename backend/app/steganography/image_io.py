"""Leitura segura e normalização de imagens para RGB (+ alfa), e escrita de PNG real.

Conversões definidas (documentadas em docs/DECISOES.md):
  * RGB, RGBA                       -> tal como estão (alfa separado e preservado intacto)
  * L, 1 (cinzento/bilevel)         -> RGB (canal replicado)
  * LA                              -> RGBA
  * P (paleta)                      -> RGBA se tiver transparência, senão RGB
  * CMYK, YCbCr, LAB, HSV           -> RGB (conversão simples do Pillow, sem gestão de cor)
  * 16 bits (I;16, I) e F           -> 8 bits (byte mais significativo) e depois RGB
  * GIF/PNG/WEBP animados           -> só o 1.º fotograma (com aviso)
Ao ocultar: aplica-se a orientação EXIF e converte-se o perfil ICC para sRGB; EXIF/ICC não são
escritos na saída. Ao extrair não se altera nada (só descodificar).
"""

from __future__ import annotations

import io
import warnings
from dataclasses import dataclass, field

import numpy as np
from PIL import Image, ImageCms, ImageOps, UnidentifiedImageError

from app.core.errors import AppError

SUPPORTED_FORMATS = {"PNG", "JPEG", "WEBP", "BMP", "GIF", "TIFF", "ICO"}

_MAGIC = (
    (b"\x89PNG\r\n\x1a\n", "PNG"),
    (b"\xff\xd8\xff", "JPEG"),
    (b"GIF87a", "GIF"),
    (b"GIF89a", "GIF"),
    (b"BM", "BMP"),
    (b"II*\x00", "TIFF"),
    (b"MM\x00*", "TIFF"),
    (b"\x00\x00\x01\x00", "ICO"),
)


def sniff_format(data: bytes) -> str | None:
    """Identifica o formato pelos *magic bytes* (não confia em extensão nem MIME)."""
    for magic, fmt in _MAGIC:
        if data.startswith(magic):
            return fmt
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "WEBP"
    return None


@dataclass
class LoadedImage:
    rgb: np.ndarray  # H×W×3 uint8, contíguo
    alpha: np.ndarray | None  # H×W uint8 ou None
    width: int
    height: int
    format: str
    size_bytes: int
    warnings: list[str] = field(default_factory=list)


def _to_8bit_gray(im: Image.Image) -> Image.Image:
    arr = np.asarray(im).astype(np.int64)
    if arr.size and arr.max() > 255:
        arr = arr >> 8
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def _srgb_from_icc(im: Image.Image) -> Image.Image:
    profile = im.info.get("icc_profile")
    if not profile or im.mode not in ("RGB", "RGBA", "L", "LA", "CMYK"):
        return im
    try:
        src = ImageCms.ImageCmsProfile(io.BytesIO(profile))
        dst = ImageCms.createProfile("sRGB")
        mode = "RGBA" if im.mode in ("RGBA", "LA") else "RGB"
        return ImageCms.profileToProfile(im, src, dst, outputMode=mode)
    except Exception:  # perfil inválido: seguir sem conversão
        return im


def _normalise(im: Image.Image) -> tuple[np.ndarray, np.ndarray | None]:
    mode = im.mode
    if mode in ("I;16", "I;16L", "I;16B", "I;16N", "I", "F"):
        im = _to_8bit_gray(im)
        mode = im.mode
    if mode == "1":
        im = im.convert("L")
        mode = "L"
    if mode in ("P", "PA"):
        im = im.convert("RGBA" if "transparency" in im.info or mode == "PA" else "RGB")
    elif mode in ("L",):
        im = im.convert("RGB")
    elif mode in ("LA", "RGBa", "La"):
        im = im.convert("RGBA")
    elif mode not in ("RGB", "RGBA"):
        im = im.convert("RGB")  # CMYK, YCbCr, LAB, HSV…
    arr = np.asarray(im)
    if arr.shape[2] == 4:
        return np.ascontiguousarray(arr[..., :3]), np.ascontiguousarray(arr[..., 3])
    return np.ascontiguousarray(arr), None


def load_image(data: bytes, *, max_pixels: int, for_embedding: bool) -> LoadedImage:
    """Descodifica de verdade a imagem (valida formato, dimensões e conteúdo)."""
    sniffed = sniff_format(data)
    if sniffed is None or sniffed not in SUPPORTED_FORMATS:
        raise AppError("UNSUPPORTED_IMAGE_FORMAT")
    Image.MAX_IMAGE_PIXELS = max_pixels
    notes: list[str] = []
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            im = Image.open(io.BytesIO(data))
            if im.format not in SUPPORTED_FORMATS:
                raise AppError("UNSUPPORTED_IMAGE_FORMAT")
            width, height = im.size
            if width <= 0 or height <= 0 or width * height > max_pixels:
                raise AppError(
                    "FILE_TOO_LARGE",
                    f"A imagem tem demasiados píxeis (máximo {max_pixels:,} ≈ {max_pixels / 1e6:.0f} MP).".replace(
                        ",", " "
                    ),
                )
            fmt = im.format
            frames = getattr(im, "n_frames", 1)
            if frames > 1:
                im.seek(0)
                notes.append(
                    f"A imagem tem {frames} fotogramas ({fmt}); só o primeiro é usado e a saída será um PNG estático."
                )
            im.load()
            if for_embedding:
                im = ImageOps.exif_transpose(im)
                im = _srgb_from_icc(im)
            rgb, alpha = _normalise(im)
    except AppError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise AppError("FILE_TOO_LARGE", "A imagem tem demasiados píxeis.") from None
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, EOFError, MemoryError):
        raise AppError("CORRUPTED_IMAGE", "Não foi possível descodificar a imagem (ficheiro inválido ou corrompido).") from None
    return LoadedImage(
        rgb=rgb,
        alpha=alpha,
        width=rgb.shape[1],
        height=rgb.shape[0],
        format=fmt,
        size_bytes=len(data),
        warnings=notes,
    )


def encode_png(rgb: np.ndarray, alpha: np.ndarray | None) -> bytes:
    """PNG real (RGB ou RGBA), sem EXIF, sem perfil ICC e sem metadados de texto."""
    arr = rgb if alpha is None else np.dstack([rgb, alpha])
    im = Image.fromarray(np.ascontiguousarray(arr))
    buf = io.BytesIO()
    im.save(buf, format="PNG", compress_level=6)
    return buf.getvalue()
