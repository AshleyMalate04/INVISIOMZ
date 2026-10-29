"""Pacote interno: ZIP (sem compressão) + `manifest.json`.

Decisões de segurança:
  * As entradas de ficheiros têm nomes internos FIXOS (`files/0001.bin`…): os nomes reais só existem no
    manifesto (como texto sanitizado), por isso Zip Slip é impossível por construção.
  * Só se aceitam entradas STORED (sem compressão): a razão de compressão é sempre 1, não há zip bombs.
  * Na leitura valida-se tudo (nº de entradas, tamanhos declarados, nomes, SHA-256) antes de devolver.
"""

from __future__ import annotations

import hashlib
import hmac
import io
import json
import mimetypes
import re
import zipfile
from dataclasses import dataclass

from app.core.errors import AppError
from app.core.filenames import sanitize_filename

MANIFEST_NAME = "manifest.json"
MANIFEST_VERSION = 1
_FIXED_DATE = (1980, 1, 1, 0, 0, 0)  # sem datas reais no ZIP
_ID_RE = re.compile(r"^\d{4}$")
MAX_MANIFEST_BYTES = 2 * 1024 * 1024


@dataclass
class PackedFile:
    name: str
    data: bytes


@dataclass
class ExtractedFile:
    id: str
    name: str
    size: int
    sha256: str
    mime: str
    data: bytes


@dataclass
class Package:
    message: str | None
    files: list[ExtractedFile]


def _entry_name(index: int) -> str:
    return f"files/{index:04d}.bin"


def _unique_name(name: str, used: set[str]) -> str:
    if name.lower() not in used:
        used.add(name.lower())
        return name
    stem, dot, ext = name.rpartition(".")
    if not dot:
        stem, ext = name, ""
    n = 2
    while True:
        candidate = f"{stem} ({n}){'.' + ext if ext else ''}"
        if candidate.lower() not in used:
            used.add(candidate.lower())
            return candidate
        n += 1


def build_package(message: str | None, files: list[PackedFile]) -> bytes:
    """Constrói o ZIP em memória com o manifesto (SHA-256 de cada ficheiro)."""
    used: set[str] = set()
    entries = []
    for i, f in enumerate(files, start=1):
        name = _unique_name(sanitize_filename(f.name), used)
        entries.append(
            {
                "id": f"{i:04d}",
                "name": name,
                "size": len(f.data),
                "sha256": hashlib.sha256(f.data).hexdigest(),
                "mime": mimetypes.guess_type(name)[0] or "application/octet-stream",
            }
        )
    manifest = {"v": MANIFEST_VERSION, "message": message if message else None, "files": entries}
    manifest_bytes = json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_STORED) as zf:
        zi = zipfile.ZipInfo(MANIFEST_NAME, date_time=_FIXED_DATE)
        zi.compress_type = zipfile.ZIP_STORED
        zf.writestr(zi, manifest_bytes)
        for i, f in enumerate(files, start=1):
            zi = zipfile.ZipInfo(_entry_name(i), date_time=_FIXED_DATE)
            zi.compress_type = zipfile.ZIP_STORED
            zf.writestr(zi, f.data)
    return buf.getvalue()


def _recovery_failed(detail: str) -> AppError:
    return AppError("ATTACHMENT_RECOVERY_FAILED", f"Falha ao recuperar os anexos: {detail}.")


def parse_package(data: bytes, *, max_files: int, max_total_bytes: int) -> Package:
    """Lê e valida o pacote. Nunca confia em nomes, tamanhos ou tipos declarados."""
    try:
        return _parse_package(data, max_files=max_files, max_total_bytes=max_total_bytes)
    except (zipfile.BadZipFile, zipfile.LargeZipFile, RuntimeError, ValueError, EOFError, OSError):
        raise _recovery_failed("pacote inválido") from None


def _parse_package(data: bytes, *, max_files: int, max_total_bytes: int) -> Package:
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise _recovery_failed("pacote inválido") from None
    with zf:
        infos = zf.infolist()
        if len(infos) > max_files + 1:
            raise _recovery_failed("demasiadas entradas")
        by_name = {}
        for info in infos:
            if info.filename in by_name:
                raise _recovery_failed("entradas duplicadas")
            if info.compress_type != zipfile.ZIP_STORED:
                raise _recovery_failed("entrada comprimida não permitida")
            if info.flag_bits & 0x1:
                raise _recovery_failed("entrada cifrada não permitida")
            by_name[info.filename] = info
        if MANIFEST_NAME not in by_name:
            raise _recovery_failed("manifesto em falta")
        minfo = by_name[MANIFEST_NAME]
        if minfo.file_size > MAX_MANIFEST_BYTES:
            raise _recovery_failed("manifesto demasiado grande")
        try:
            manifest = json.loads(zf.read(minfo).decode("utf-8"))
        except (ValueError, UnicodeDecodeError, zipfile.BadZipFile):
            raise _recovery_failed("manifesto ilegível") from None
        if not isinstance(manifest, dict) or manifest.get("v") != MANIFEST_VERSION:
            raise _recovery_failed("versão do manifesto não suportada")
        message = manifest.get("message")
        if message is not None and not isinstance(message, str):
            raise _recovery_failed("mensagem inválida")
        entries = manifest.get("files")
        if not isinstance(entries, list) or len(entries) > max_files:
            raise _recovery_failed("lista de ficheiros inválida")
        if len(by_name) != len(entries) + 1:
            raise _recovery_failed("entradas não declaradas no manifesto")

        files: list[ExtractedFile] = []
        total = 0
        used: set[str] = set()
        for e in entries:
            if not isinstance(e, dict):
                raise _recovery_failed("entrada de manifesto inválida")
            fid, name, size, sha, mime = (e.get(k) for k in ("id", "name", "size", "sha256", "mime"))
            if not (
                isinstance(fid, str) and _ID_RE.match(fid)
                and isinstance(name, str)
                and isinstance(size, int) and not isinstance(size, bool) and size >= 0
                and isinstance(sha, str) and re.fullmatch(r"[0-9a-f]{64}", sha)
            ):
                raise _recovery_failed("entrada de manifesto inválida")
            info = by_name.get(f"files/{fid}.bin")
            if info is None or info.file_size != size:
                raise _recovery_failed("ficheiro em falta ou com tamanho diferente do manifesto")
            total += size
            if total > max_total_bytes:
                raise _recovery_failed("tamanho total excede o limite")
            content = zf.read(info)
            if len(content) != size or not hmac.compare_digest(hashlib.sha256(content).hexdigest(), sha):
                raise _recovery_failed("a verificação SHA-256 do ficheiro falhou")
            safe_name = _unique_name(sanitize_filename(name), used)
            safe_mime = mime if isinstance(mime, str) and re.fullmatch(r"[\w.+-]+/[\w.+-]+", mime) else "application/octet-stream"
            files.append(ExtractedFile(id=fid, name=safe_name, size=size, sha256=sha, mime=safe_mime, data=content))
    return Package(message=message, files=files)


def build_download_zip(message: str | None, files: list[ExtractedFile]) -> bytes:
    """ZIP para o utilizador (nomes já sanitizados e únicos); inclui `mensagem.txt` se existir mensagem."""
    buf = io.BytesIO()
    used: set[str] = set()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        if message:
            zf.writestr(zipfile.ZipInfo("mensagem.txt", date_time=_FIXED_DATE), message.encode("utf-8"))
            used.add("mensagem.txt")
        for f in files:
            name = _unique_name(f.name, used)
            zi = zipfile.ZipInfo(name, date_time=_FIXED_DATE)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(zi, f.data)
    return buf.getvalue()
