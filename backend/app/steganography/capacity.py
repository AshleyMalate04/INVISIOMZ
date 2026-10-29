"""Cálculo de capacidade (bruta e útil) para LSB em R, G, B."""

from __future__ import annotations

import json
import math

from app.crypto.aead import TAG_LEN
from app.steganography.envelope import HEADER_SLOTS

VALID_BITS = (1, 2)

# Sobrecarga do pacote ZIP (entradas STORED, nomes internos fixos, datas fixas) — ver bundle/package.py
ZIP_EOCD = 22
_ZIP_ENTRY_FIXED = 30 + 46  # cabeçalho local + entrada do directório central
MANIFEST_ENTRY_NAME = "manifest.json"
FILE_ENTRY_NAME_LEN = len("files/0001.bin")
_MANIFEST_SKELETON = len(json.dumps({"v": 1, "message": None, "files": []}, separators=(",", ":")))
_MANIFEST_PER_FILE = len(
    json.dumps({"id": "0001", "name": "", "size": 10**9, "sha256": "0" * 64, "mime": ""}, separators=(",", ":"))
) + 1  # vírgula
ESTIMATE_MARGIN = 64


def raw_capacity_bytes(width: int, height: int, bits: int) -> int:
    """Capacidade bruta: largura × altura × 3 canais × bits ÷ 8 (fórmula do enunciado, 1 bit)."""
    return (width * height * 3 * bits) // 8


def body_capacity_bytes(width: int, height: int, bits: int) -> int:
    """Bytes de corpo cifrado que cabem depois de reservar as posições do cabeçalho."""
    slots = width * height * 3 - HEADER_SLOTS
    return max(0, (slots * bits) // 8)


def useful_capacity_bytes(width: int, height: int, bits: int) -> int:
    """Bytes de pacote (ZIP) em claro: corpo menos a tag GCM de 16 bytes."""
    return max(0, body_capacity_bytes(width, height, bits) - TAG_LEN)


def fixed_overhead_bytes() -> int:
    """Sobrecarga fixa do pacote (EOCD + entrada do manifesto + esqueleto JSON + margem)."""
    manifest_entry = _ZIP_ENTRY_FIXED + 2 * len(MANIFEST_ENTRY_NAME)
    return ZIP_EOCD + manifest_entry + _MANIFEST_SKELETON + ESTIMATE_MARGIN


def per_file_overhead_bytes() -> int:
    """Sobrecarga por ficheiro, SEM contar o nome (nome UTF-8 conta uma vez no manifesto) nem o tipo MIME."""
    zip_entry = _ZIP_ENTRY_FIXED + 2 * FILE_ENTRY_NAME_LEN
    return zip_entry + _MANIFEST_PER_FILE + 40  # 40 B de folga para o campo "mime" e escapes JSON


def estimate_package_size(message_json_bytes: int, files: list[tuple[int, int]]) -> int:
    """Estimativa (conservadora) do tamanho do pacote.

    `message_json_bytes`: tamanho da mensagem codificada como string JSON (UTF-8), 0 se não houver.
    `files`: lista de (bytes_do_nome_utf8, tamanho_do_ficheiro).
    """
    total = fixed_overhead_bytes() + message_json_bytes
    for name_bytes, size in files:
        total += size + per_file_overhead_bytes() + name_bytes
    return total


def symbols_needed(ciphertext_len: int, bits: int) -> int:
    return math.ceil(ciphertext_len * 8 / bits)
