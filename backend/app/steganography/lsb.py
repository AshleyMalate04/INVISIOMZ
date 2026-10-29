"""LSB real nos canais R, G, B com posições pseudo-aleatórias derivadas de uma sub-chave.

Modelo: a imagem RGB (H×W×3, uint8) é vista como uma lista de M = H·W·3 «posições» (uma por canal).

* Cabeçalho: nas primeiras 368 posições, SEMPRE com 1 bit por posição (para ser legível sem senha).
* Corpo (texto cifrado): nas restantes n = M − 368 posições, com `bits` (1 ou 2) por posição.
  A ordem das posições é uma permutação de [0, n) derivada da `perm_key` (HKDF da chave da senha):
  ordenam-se n chaves de 32 bits produzidas por AES-256-CTR (determinístico e independente da versão
  do NumPy, porque a ordenação é estável).
* Enchimento: todas as posições livres recebem bits aleatórios (`os.urandom`), de modo que a zona com
  dados e a zona sem dados tenham a mesma estatística.

LSB continua a ser detectável por estegoanálise (qui-quadrado, RS…). Isto reduz padrões, não os elimina.
"""

from __future__ import annotations

import os

import numpy as np
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from app.core.errors import AppError
from app.steganography.capacity import symbols_needed
from app.steganography.envelope import HEADER_LEN, HEADER_SLOTS

_CHUNK = 16 * 1024 * 1024


def _keystream_u32(key: bytes, count: int) -> np.ndarray:
    """`count` inteiros de 32 bits (little-endian) do keystream AES-256-CTR (IV nulo, chave única)."""
    out = np.empty(count, dtype="<u4")
    raw = out.view(np.uint8)
    encryptor = Cipher(algorithms.AES(key), modes.CTR(bytes(16))).encryptor()
    total = count * 4
    offset = 0
    while offset < total:
        n = min(_CHUNK, total - offset)
        raw[offset : offset + n] = np.frombuffer(encryptor.update(bytes(n)), dtype=np.uint8)
        offset += n
    return out


def _radix_argsort_consuming(holder: list[np.ndarray]) -> np.ndarray:
    """Ordenação estável por chaves de 32 bits (little-endian) em duas passagens *radix* de 16 bits (LSD).

    O NumPy usa radix sort (O(n)) para inteiros de 16 bits e timsort para 32 bits. Ordenar de forma estável
    primeiro pelos 16 bits baixos e depois pelos 16 altos dá EXACTAMENTE o mesmo resultado que uma ordenação
    estável pela chave completa — por isso o formato não muda. Recebe a chave dentro de uma lista para a poder
    libertar a meio (menos memória no pico).
    """
    keys = holder.pop()
    words = keys.view("<u2")  # [baixo0, alto0, baixo1, alto1, …] porque as chaves são "<u4"
    by_low = np.argsort(np.ascontiguousarray(words[0::2]), kind="stable").astype(np.uint32)
    high = np.ascontiguousarray(words[1::2])[by_low]
    del keys, words
    by_high = np.argsort(high, kind="stable")
    del high
    return by_low[by_high]


def _stable_argsort_u32(keys: np.ndarray) -> np.ndarray:
    """Equivale a `np.argsort(keys, kind="stable")` para chaves `<u4` (usado também nos testes)."""
    return _radix_argsort_consuming([np.ascontiguousarray(keys, dtype="<u4")]).astype(np.int64)


def permutation(n: int, key: bytes) -> np.ndarray:
    """Permutação pseudo-aleatória determinística de [0, n) (como uint32)."""
    return _radix_argsort_consuming([_keystream_u32(key, n)])


def _flat(rgb: np.ndarray) -> np.ndarray:
    if rgb.dtype != np.uint8 or rgb.ndim != 3 or rgb.shape[2] != 3:
        raise ValueError("rgb deve ser uint8 com forma (H, W, 3)")
    return rgb.reshape(-1)


def slots_available(rgb: np.ndarray) -> int:
    return max(0, rgb.shape[0] * rgb.shape[1] * 3 - HEADER_SLOTS)


def embed(
    rgb: np.ndarray, header: bytes, ciphertext: bytes, bits: int, perm_key: bytes, perm: np.ndarray | None = None
) -> np.ndarray:
    """Devolve uma NOVA imagem RGB com cabeçalho + corpo escondidos (a original não é modificada).

    `perm` permite reutilizar uma permutação já calculada (é a parte mais cara); por defeito calcula-se aqui.
    """
    if len(header) != HEADER_LEN:
        raise ValueError("cabeçalho com tamanho inválido")
    n_avail = slots_available(rgb)
    n_sym = symbols_needed(len(ciphertext), bits)
    if n_sym > n_avail:
        raise AppError("CAPACITY_EXCEEDED")

    out = np.ascontiguousarray(rgb).copy()
    flat = _flat(out)

    # 1) cabeçalho: 1 bit por posição, sequencial
    h_bits = np.unpackbits(np.frombuffer(header, dtype=np.uint8))
    flat[:HEADER_SLOTS] = (flat[:HEADER_SLOTS] & 0xFE) | h_bits

    # 2) corpo: símbolos de `bits` bits
    c_bits = np.unpackbits(np.frombuffer(ciphertext, dtype=np.uint8))
    if bits == 1:
        symbols = c_bits
    else:
        symbols = (c_bits[0::2] << 1) | c_bits[1::2]
    mask = np.uint8((1 << bits) - 1)

    filler = np.frombuffer(os.urandom(n_avail), dtype=np.uint8) & mask  # enchimento aleatório
    if perm is None:
        perm = permutation(n_avail, perm_key)
    filler[perm[:n_sym]] = symbols
    body = flat[HEADER_SLOTS:]
    body[:] = (body & ~mask) | filler
    return out


def read_header_bytes(rgb: np.ndarray) -> bytes:
    """Lê os 46 bytes do cabeçalho (1 bit por posição). Imagem pequena demais => sem dados."""
    flat = _flat(rgb)
    if flat.size < HEADER_SLOTS:
        raise AppError("NO_HIDDEN_DATA")
    return np.packbits(flat[:HEADER_SLOTS] & 1).tobytes()


def read_body(rgb: np.ndarray, ct_len: int, bits: int, perm_key: bytes, perm: np.ndarray | None = None) -> bytes:
    """Lê `ct_len` bytes do corpo. O comprimento é validado ANTES de qualquer alocação grande."""
    n_avail = slots_available(rgb)
    n_sym = symbols_needed(ct_len, bits)
    if n_sym > n_avail:
        raise AppError("TRUNCATED_PAYLOAD")
    flat = _flat(rgb)
    if perm is None:
        perm = permutation(n_avail, perm_key)
    mask = np.uint8((1 << bits) - 1)
    symbols = flat[HEADER_SLOTS:][perm[:n_sym]] & mask
    if bits == 1:
        c_bits = symbols
    else:
        c_bits = np.empty(n_sym * 2, dtype=np.uint8)
        c_bits[0::2] = symbols >> 1
        c_bits[1::2] = symbols & 1
    return np.packbits(c_bits).tobytes()[:ct_len]
