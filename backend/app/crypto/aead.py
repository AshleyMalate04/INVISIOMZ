"""AES-256-GCM autenticado, com o cabeçalho do envelope como dados associados (AAD)."""

from __future__ import annotations

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.errors import AppError

NONCE_LEN = 12
TAG_LEN = 16


def encrypt(key: bytes, nonce: bytes, plaintext: bytes, aad: bytes) -> bytes:
    """Devolve ciphertext || tag (tag de 16 bytes no fim)."""
    return AESGCM(key).encrypt(nonce, plaintext, aad)


def decrypt(key: bytes, nonce: bytes, ciphertext: bytes, aad: bytes) -> bytes:
    """Só devolve conteúdo se a tag GCM autenticar; caso contrário, erro único e genérico."""
    try:
        return AESGCM(key).decrypt(nonce, ciphertext, aad)
    except InvalidTag:
        raise AppError("WRONG_PASSWORD_OR_TAMPERED") from None
