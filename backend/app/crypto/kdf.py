"""Derivação de chaves: Scrypt (senha -> chave mestra) e HKDF-SHA256 (chave mestra -> sub-chaves)."""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

from app.core.errors import AppError

KDF_ID_SCRYPT = 1
SALT_LEN = 16
KEY_LEN = 32

# Limites aceites ao LER parâmetros de uma imagem (o cabeçalho não é autenticado antes do KDF,
# por isso um cabeçalho malicioso não pode pedir memória/tempo arbitrários).
MIN_LOG2N, MAX_LOG2N = 14, 20
MAX_R, MAX_P = 16, 4
MAX_SCRYPT_MEMORY = 256 * 1024 * 1024  # 128 * N * r

INFO_ENC = b"invisiomz/v1/aes-256-gcm"
INFO_PERM = b"invisiomz/v1/pixel-permutation"


@dataclass(frozen=True)
class KdfParams:
    log2n: int
    r: int
    p: int

    @property
    def n(self) -> int:
        return 1 << self.log2n

    def validate(self) -> None:
        if not (MIN_LOG2N <= self.log2n <= MAX_LOG2N) or not (1 <= self.r <= MAX_R) or not (1 <= self.p <= MAX_P):
            raise AppError("CORRUPTED_IMAGE", "Parâmetros de derivação de chave fora do intervalo permitido.")
        if 128 * self.n * self.r > MAX_SCRYPT_MEMORY:
            raise AppError("CORRUPTED_IMAGE", "Parâmetros de derivação de chave excedem o limite de memória.")


def normalize_password(password: str) -> bytearray:
    """NFKC + UTF-8, em `bytearray` para permitir a limpeza (best effort) após o uso."""
    return bytearray(unicodedata.normalize("NFKC", password).encode("utf-8"))


def derive_master_key(password: str, salt: bytes, params: KdfParams) -> bytes:
    params.validate()
    pw = normalize_password(password)
    try:
        kdf = Scrypt(salt=salt, length=KEY_LEN, n=params.n, r=params.r, p=params.p)
        return kdf.derive(bytes(pw))
    finally:
        for i in range(len(pw)):  # limpeza best effort: str/bytes imutáveis em Python não são zeráveis
            pw[i] = 0


def derive_subkey(master: bytes, info: bytes) -> bytes:
    """HKDF-SHA256: separa a chave de cifra da chave da permutação."""
    return HKDF(algorithm=hashes.SHA256(), length=KEY_LEN, salt=None, info=info).derive(master)


@dataclass(frozen=True)
class KeyMaterial:
    enc_key: bytes
    perm_key: bytes


def derive_keys(password: str, salt: bytes, params: KdfParams) -> KeyMaterial:
    master = derive_master_key(password, salt, params)
    return KeyMaterial(enc_key=derive_subkey(master, INFO_ENC), perm_key=derive_subkey(master, INFO_PERM))
