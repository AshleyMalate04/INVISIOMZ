"""Sanitização de nomes de ficheiro e geração do nome de saída."""

from __future__ import annotations

import re
import secrets
import string
import unicodedata
from urllib.parse import quote

_RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
_FORBIDDEN = re.compile(r'[<>:"/\\|?*\x00-\x1f\x7f]')
_MAX_LEN = 100
_ALPHABET = string.ascii_lowercase + string.digits


def _strip_unicode_trouble(text: str) -> str:
    # Remove controlo (Cc), formatação invisível/bidi (Cf), substitutos (Cs) e uso privado (Co).
    return "".join(ch for ch in text if unicodedata.category(ch) not in {"Cc", "Cf", "Cs", "Co", "Cn"})


def sanitize_filename(name: str | None, fallback: str = "ficheiro") -> str:
    """Devolve só o nome-base seguro (sem caminhos, sem caracteres perigosos, comprimento limitado)."""
    text = unicodedata.normalize("NFC", name or "")
    text = text.replace("\\", "/").split("/")[-1]  # sem caminhos
    text = _strip_unicode_trouble(text)
    text = _FORBIDDEN.sub("_", text).strip(" .")
    if not text:
        return fallback
    stem, dot, ext = text.rpartition(".")
    if not dot:
        stem, ext = text, ""
    if stem.upper() in _RESERVED or stem.upper().split(".")[0] in _RESERVED:
        stem = f"_{stem}"
    if len(ext) > 12:
        stem, ext = f"{stem}.{ext}", ""
    ext_part = f".{ext}" if ext else ""
    stem = stem[: max(1, _MAX_LEN - len(ext_part))].rstrip(" .") or fallback
    return stem + ext_part


def make_output_name(original: str | None) -> str:
    """`foto_praia.jpg` -> `k7x2_foto_praia.png` (prefixo aleatório de 4 caracteres)."""
    base = sanitize_filename(original, fallback="imagem")
    stem = base.rsplit(".", 1)[0] if "." in base else base
    stem = stem.strip(" .") or "imagem"
    prefix = "".join(secrets.choice(_ALPHABET) for _ in range(4))
    return f"{prefix}_{stem[: _MAX_LEN - 9]}.png"


def ascii_fallback(name: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    ascii_name = re.sub(r"[^A-Za-z0-9._-]", "_", ascii_name) or "ficheiro"
    return ascii_name


def content_disposition(name: str, disposition: str = "attachment") -> str:
    """Cabeçalho `Content-Disposition` seguro (RFC 6266 / RFC 5987)."""
    return f"{disposition}; filename=\"{ascii_fallback(name)}\"; filename*=UTF-8''{quote(name, safe='')}"
