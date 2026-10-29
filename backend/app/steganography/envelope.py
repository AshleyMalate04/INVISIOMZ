"""Envelope InvisioMZ: cabeçalho de 46 bytes (sempre lido em modo de 1 bit) + corpo cifrado.

Ver `docs/FORMATO_BINARIO.md` para o diagrama byte a byte.

    off  len  campo
      0    4  magic            b"IVMZ"
      4    1  versão           1
      5    1  bits do corpo    1 ou 2
      6    1  id do KDF        1 = scrypt
      7    1  log2(N)          scrypt
      8    1  r                scrypt
      9    1  p                scrypt
     10   16  salt             aleatório por operação
     26   12  nonce AES-GCM    aleatório por operação
     38    4  ct_len           bytes do corpo cifrado (inclui a tag GCM de 16 B), big-endian
     42    4  CRC32            dos bytes 0..41, big-endian

Os bytes 0..41 são usados como AAD do AES-GCM: qualquer alteração ao cabeçalho invalida a autenticação.
"""

from __future__ import annotations

import os
import struct
import zlib
from dataclasses import dataclass

from app.core.errors import AppError
from app.crypto import aead, kdf

MAGIC = b"IVMZ"
VERSION = 1
HEADER_LEN = 46
AAD_LEN = 42
HEADER_SLOTS = HEADER_LEN * 8  # 368 posições (1 bit cada) reservadas ao cabeçalho
_FMT = ">4sBBBBBB16s12sI"
assert struct.calcsize(_FMT) == AAD_LEN


@dataclass(frozen=True)
class Header:
    bits: int
    kdf_params: kdf.KdfParams
    salt: bytes
    nonce: bytes
    ct_len: int
    version: int = VERSION
    kdf_id: int = kdf.KDF_ID_SCRYPT

    def aad(self) -> bytes:
        return struct.pack(
            _FMT,
            MAGIC,
            self.version,
            self.bits,
            self.kdf_id,
            self.kdf_params.log2n,
            self.kdf_params.r,
            self.kdf_params.p,
            self.salt,
            self.nonce,
            self.ct_len,
        )

    def pack(self) -> bytes:
        aad = self.aad()
        return aad + struct.pack(">I", zlib.crc32(aad) & 0xFFFFFFFF)


def parse_header(raw: bytes) -> Header:
    """Valida e interpreta o cabeçalho; os erros distinguem 'sem dados' de 'corrompido'."""
    if len(raw) != HEADER_LEN:
        raise AppError("NO_HIDDEN_DATA")
    if raw[:4] != MAGIC:
        raise AppError("NO_HIDDEN_DATA")
    if raw[4] != VERSION:
        raise AppError("UNSUPPORTED_VERSION")
    (crc,) = struct.unpack(">I", raw[AAD_LEN:])
    if zlib.crc32(raw[:AAD_LEN]) & 0xFFFFFFFF != crc:
        raise AppError("CORRUPTED_IMAGE")
    _, version, bits, kdf_id, log2n, r, p, salt, nonce, ct_len = struct.unpack(_FMT, raw[:AAD_LEN])
    if bits not in (1, 2) or kdf_id != kdf.KDF_ID_SCRYPT:
        raise AppError("CORRUPTED_IMAGE")
    params = kdf.KdfParams(log2n, r, p)
    params.validate()
    if ct_len < aead.TAG_LEN:
        raise AppError("CORRUPTED_IMAGE")
    return Header(bits=bits, kdf_params=params, salt=salt, nonce=nonce, ct_len=ct_len, version=version, kdf_id=kdf_id)


@dataclass(frozen=True)
class Sealed:
    header: Header
    ciphertext: bytes
    keys: kdf.KeyMaterial


def seal(plaintext: bytes, password: str, bits: int, params: kdf.KdfParams) -> Sealed:
    """Cifra `plaintext` com salt e nonce novos (`os.urandom`) e devolve cabeçalho + corpo + chaves."""
    salt = os.urandom(kdf.SALT_LEN)
    nonce = os.urandom(aead.NONCE_LEN)
    keys = kdf.derive_keys(password, salt, params)
    header = Header(
        bits=bits,
        kdf_params=params,
        salt=salt,
        nonce=nonce,
        ct_len=len(plaintext) + aead.TAG_LEN,
    )
    ciphertext = aead.encrypt(keys.enc_key, nonce, plaintext, header.aad())
    return Sealed(header=header, ciphertext=ciphertext, keys=keys)


def open_envelope(header: Header, ciphertext: bytes, keys: kdf.KeyMaterial) -> bytes:
    return aead.decrypt(keys.enc_key, header.nonce, ciphertext, header.aad())
