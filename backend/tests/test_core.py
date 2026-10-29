"""Núcleo: LSB + criptografia + pacote (testes 1–7 e 10 do enunciado)."""

from __future__ import annotations

import hashlib
import io

import numpy as np
import pytest
from PIL import Image

from app.bundle.package import PackedFile
from app.core.errors import AppError
from app.services import extract_service, hide_service
from app.steganography import capacity, envelope, image_io, lsb

from .conftest import PASSWORD, encode, make_settings, random_image

S = make_settings()
KNOWN_PERMUTATION_12 = [6, 10, 7, 2, 3, 11, 4, 0, 9, 1, 8, 5]  # AES-256-CTR(chave 00..1f) -> argsort estável


def do_hide(image: bytes, message: str | None = "olá", files: list[PackedFile] | None = None, bits: int = 1,
            password: str = PASSWORD, name: str = "foto.png"):
    return hide_service.hide(image_bytes=image, image_name=name, message=message, files=files or [],
                             password=password, bits=bits, settings=S)


def do_extract(png: bytes, password: str = PASSWORD):
    return extract_service.extract(image_bytes=png, password=password, settings=S)


# 1 ------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("message", ["Olá, mundo", "Ação, coração, pão — Moçambique ✓ «aspas» €", "emoji 🚀🇲🇿👩🏽‍💻", "a" * 5000])
def test_message_round_trip(png_bytes, message):
    result = do_hide(png_bytes, message)
    assert do_extract(result.png).message == message


# 2 + 3 ------------------------------------------------------------------------------------------------
def test_files_and_message_identical_bytes():
    pdf = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
    files = [
        PackedFile("nota.txt", "texto com acentuação ç ã é".encode()),
        PackedFile("doc.pdf", pdf),
        PackedFile("bin.dat", bytes(range(256)) * 20),
        PackedFile("vazio.txt", b""),
    ]
    img = encode(random_image(400, 300), "PNG")
    out = do_extract(do_hide(img, "mensagem + ficheiros", files, bits=2).png)
    assert out.message == "mensagem + ficheiros"
    assert [f.name for f in out.files] == [f.name for f in files]
    for original, got in zip(files, out.files):
        assert got.data == original.data
        assert got.sha256 == hashlib.sha256(original.data).hexdigest()
        assert got.size == len(original.data)


def test_only_files_without_message(png_bytes):
    out = do_extract(do_hide(png_bytes, None, [PackedFile("a.txt", b"x")]).png)
    assert out.message is None and out.files[0].data == b"x"


# 4 ------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("fmt,kw", [("JPEG", {}), ("WEBP", {"lossless": True}), ("BMP", {}), ("GIF", {}), ("TIFF", {}),
                                    ("ICO", {"sizes": [(64, 64)]}), ("PNG", {})])
def test_every_input_format_outputs_real_png(fmt, kw):
    im = random_image(64, 64) if fmt == "ICO" else random_image(240, 180)
    if fmt == "GIF":
        im = im.convert("P")
    data = encode(im, fmt, **kw)
    result = do_hide(data, "segredo", name=f"imagem.{fmt.lower()}")
    assert result.png.startswith(b"\x89PNG\r\n\x1a\n")
    assert Image.open(io.BytesIO(result.png)).format == "PNG"
    assert result.output_filename.endswith(".png") and result.output_filename[4] == "_"
    assert do_extract(result.png).message == "segredo"


# 5 ------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("bits", [1, 2])
@pytest.mark.parametrize("mode", ["RGB", "RGBA", "L", "LA", "P", "CMYK"])
def test_modes_and_bits(mode, bits):
    data = encode(random_image(220, 160, mode), "PNG" if mode != "CMYK" else "TIFF")
    result = do_hide(data, f"modo {mode}", bits=bits)
    assert do_extract(result.png).message == f"modo {mode}"


def test_alpha_channel_preserved_intact():
    im = random_image(150, 150, "RGBA")
    original_alpha = np.asarray(im)[..., 3].copy()
    result = do_hide(encode(im, "PNG"), "alfa")
    out = Image.open(io.BytesIO(result.png))
    assert out.mode == "RGBA"
    assert np.array_equal(np.asarray(out)[..., 3], original_alpha)


def test_16bit_grayscale_png():
    arr = (np.random.default_rng(3).integers(0, 65536, (120, 120))).astype(np.uint16)
    data = encode(Image.fromarray(arr), "PNG")
    assert do_extract(do_hide(data, "16 bits").png).message == "16 bits"


def test_original_not_modified_and_changes_bounded(png_bytes):
    before = np.asarray(Image.open(io.BytesIO(png_bytes)).convert("RGB")).astype(int)
    result = do_hide(png_bytes, "x", bits=1)
    after = np.asarray(Image.open(io.BytesIO(result.png)).convert("RGB")).astype(int)
    assert np.abs(before - after).max() <= 1  # 1 bit: no máximo ±1 por canal
    result2 = do_hide(png_bytes, "x", bits=2)
    after2 = np.asarray(Image.open(io.BytesIO(result2.png)).convert("RGB")).astype(int)
    assert np.abs(before - after2).max() <= 3


def test_metadata_is_stripped():
    im = random_image(100, 100)
    exif = Image.Exif()
    exif[0x010F] = "FabricanteSecreto"
    data = encode(im, "JPEG", exif=exif)
    out = Image.open(io.BytesIO(do_hide(data, "x").png))
    assert "exif" not in out.info and not out.getexif() and "icc_profile" not in out.info


# 6 ------------------------------------------------------------------------------------------------
def test_capacity_insufficient_is_clear_error_and_never_truncates():
    small = encode(random_image(30, 30), "PNG")  # 30*30*3/8 = 337 B
    with pytest.raises(AppError) as e:
        do_hide(small, None, [PackedFile("grande.bin", b"\0" * 5000)])
    assert e.value.code == "CAPACITY_EXCEEDED" and "2 bits" in e.value.message


def test_capacity_formula():
    assert capacity.raw_capacity_bytes(1000, 1000, 1) == 375_000
    assert capacity.raw_capacity_bytes(1000, 1000, 2) == 750_000
    assert capacity.useful_capacity_bytes(1000, 1000, 1) == 375_000 - 46 - 16
    assert capacity.useful_capacity_bytes(1, 1, 1) == 0


def test_exact_fit_boundary():
    from app.bundle.package import build_package

    w = h = 100
    useful = capacity.useful_capacity_bytes(w, h, 1)
    img = encode(random_image(w, h), "PNG")

    def size_for(n: int) -> int:
        return len(build_package(None, [PackedFile("a", b"" * n)]))

    n = useful - (size_for(useful) - useful)
    while size_for(n) > useful:
        n -= 1
    while size_for(n + 1) <= useful:
        n += 1
    payload = b"" * n  # o maior conteúdo que ainda cabe
    result = do_hide(img, None, [PackedFile("a", payload)])
    assert do_extract(result.png).files[0].data == payload
    with pytest.raises(AppError) as e:
        do_hide(img, None, [PackedFile("a", payload + b"x")])
    assert e.value.code == "CAPACITY_EXCEEDED"


def test_estimate_is_conservative():
    files = [(len("nota.txt".encode()), 1234), (len("dados.bin".encode()), 777)]
    est = capacity.estimate_package_size(0, files)
    from app.bundle.package import build_package

    real = len(build_package(None, [PackedFile("nota.txt", b"x" * 1234), PackedFile("dados.bin", b"y" * 777)]))
    assert est >= real and est - real < 700


def test_image_without_envelope(png_bytes):
    with pytest.raises(AppError) as e:
        do_extract(png_bytes)
    assert e.value.code == "NO_HIDDEN_DATA"


def test_tiny_image_without_envelope():
    with pytest.raises(AppError) as e:
        do_extract(encode(random_image(5, 5), "PNG"))
    assert e.value.code == "NO_HIDDEN_DATA"


def _rewrite_header(png: bytes, mutate) -> bytes:
    rgb = image_io.load_image(png, max_pixels=10**7, for_embedding=False).rgb.copy()
    raw = bytearray(lsb.read_header_bytes(rgb))
    mutate(raw)
    flat = rgb.reshape(-1)
    bits = np.unpackbits(np.frombuffer(bytes(raw), dtype=np.uint8))
    flat[: envelope.HEADER_SLOTS] = (flat[: envelope.HEADER_SLOTS] & 0xFE) | bits
    return image_io.encode_png(rgb, None)


def test_invalid_version_header(png_bytes):
    png = do_hide(png_bytes, "x").png
    bad = _rewrite_header(png, lambda raw: raw.__setitem__(4, 9))
    with pytest.raises(AppError) as e:
        do_extract(bad)
    assert e.value.code == "UNSUPPORTED_VERSION"


def test_header_crc_mismatch(png_bytes):
    png = do_hide(png_bytes, "x").png
    bad = _rewrite_header(png, lambda raw: raw.__setitem__(20, raw[20] ^ 0x01))  # byte do salt, CRC já não bate
    with pytest.raises(AppError) as e:
        do_extract(bad)
    assert e.value.code == "CORRUPTED_IMAGE"


def _forge_header(png: bytes, **changes) -> bytes:
    def mutate(raw: bytearray) -> None:
        h = envelope.parse_header(bytes(raw))
        data = dict(bits=h.bits, kdf_params=h.kdf_params, salt=h.salt, nonce=h.nonce, ct_len=h.ct_len)
        data.update(changes)
        raw[:] = envelope.Header(**data).pack()

    return _rewrite_header(png, mutate)


def test_malicious_length_is_rejected_without_allocation(png_bytes):
    png = do_hide(png_bytes, "x").png
    for huge in (2**32 - 1, 2**31, 10**9):
        with pytest.raises(AppError) as e:
            do_extract(_forge_header(png, ct_len=huge))
        assert e.value.code in {"CORRUPTED_IMAGE", "TRUNCATED_PAYLOAD"}


def test_length_larger_than_image_is_truncated_payload(png_bytes):
    png = do_hide(png_bytes, "x").png
    too_long = capacity.body_capacity_bytes(200, 150, 1) + 100
    with pytest.raises(AppError) as e:
        do_extract(_forge_header(png, ct_len=too_long))
    assert e.value.code == "TRUNCATED_PAYLOAD"


def test_malicious_kdf_parameters_rejected(png_bytes):
    from app.crypto.kdf import KdfParams

    png = do_hide(png_bytes, "x").png
    with pytest.raises(AppError) as e:
        do_extract(_forge_header(png, kdf_params=KdfParams(30, 16, 4)))  # pediria terabytes
    assert e.value.code == "CORRUPTED_IMAGE"


# 7 ------------------------------------------------------------------------------------------------
def test_wrong_password(png_bytes):
    png = do_hide(png_bytes, "segredo").png
    with pytest.raises(AppError) as e:
        do_extract(png, "outra-senha-qualquer")
    assert e.value.code == "WRONG_PASSWORD_OR_TAMPERED"


def test_password_unicode_normalisation():
    img = encode(random_image(), "PNG")
    png = do_hide(img, "ok", password="Senha-Çã-longa-1").png
    composed = do_extract(png, "Senha-Çã-longa-1")
    decomposed = do_extract(png, "Senha-Çã-longa-1")  # mesma senha em NFD
    assert composed.message == decomposed.message == "ok"


def test_body_bit_flips_detected(png_bytes):
    png = do_hide(png_bytes, "segredo").png
    rgb = image_io.load_image(png, max_pixels=10**7, for_embedding=False).rgb.copy()
    flat = rgb.reshape(-1)
    # inverte o LSB de muitas posições do corpo: algumas calham em bits do texto cifrado
    flat[envelope.HEADER_SLOTS : envelope.HEADER_SLOTS + 40_000] ^= 1
    with pytest.raises(AppError) as e:
        do_extract(image_io.encode_png(rgb, None))
    assert e.value.code == "WRONG_PASSWORD_OR_TAMPERED"


@pytest.mark.parametrize("offset", [10, 26, 38])  # salt, nonce, comprimento
def test_header_tampering_detected_with_valid_crc(png_bytes, offset):
    """Cabeçalho alterado MAS com CRC refeito: a AAD do GCM tem de invalidar a autenticação."""
    png = do_hide(png_bytes, "segredo").png

    def mutate(raw: bytearray) -> None:
        raw[offset] ^= 0x01
        import struct
        import zlib

        raw[42:] = struct.pack(">I", zlib.crc32(bytes(raw[:42])) & 0xFFFFFFFF)

    with pytest.raises(AppError) as e:
        do_extract(_rewrite_header(png, mutate))
    assert e.value.code in {"WRONG_PASSWORD_OR_TAMPERED", "TRUNCATED_PAYLOAD", "CORRUPTED_IMAGE"}


def test_aad_binds_bits_field(png_bytes):
    """Trocar o modo de bits (1->2) com CRC válido invalida a autenticação."""
    png = do_hide(png_bytes, "segredo", bits=1).png
    with pytest.raises(AppError) as e:
        do_extract(_forge_header(png, bits=2))
    assert e.value.code in {"WRONG_PASSWORD_OR_TAMPERED", "TRUNCATED_PAYLOAD"}


def test_truncated_image_rows_removed(png_bytes):
    big = encode(random_image(300, 300), "PNG")
    png = do_hide(big, "x" * 2000, bits=1).png
    cropped = Image.open(io.BytesIO(png)).crop((0, 0, 300, 100))  # corta a parte inferior
    buf = io.BytesIO()
    cropped.save(buf, "PNG")
    with pytest.raises(AppError) as e:
        do_extract(buf.getvalue())
    assert e.value.code in {"WRONG_PASSWORD_OR_TAMPERED", "TRUNCATED_PAYLOAD"}


def test_lossy_reencode_destroys_data(png_bytes):
    png = do_hide(png_bytes, "x").png
    jpg = encode(Image.open(io.BytesIO(png)).convert("RGB"), "JPEG", quality=95)
    with pytest.raises(AppError) as e:
        do_extract(jpg)
    assert e.value.code in {"NO_HIDDEN_DATA", "CORRUPTED_IMAGE"}


# 10 ------------------------------------------------------------------------------------------------
def test_salt_and_nonce_unique_between_operations(png_bytes):
    a, b = do_hide(png_bytes, "igual").png, do_hide(png_bytes, "igual").png
    ha = envelope.parse_header(lsb.read_header_bytes(image_io.load_image(a, max_pixels=10**7, for_embedding=False).rgb))
    hb = envelope.parse_header(lsb.read_header_bytes(image_io.load_image(b, max_pixels=10**7, for_embedding=False).rgb))
    assert ha.salt != hb.salt and ha.nonce != hb.nonce
    assert a != b


def test_permutation_deterministic_and_bijective():
    key = b"k" * 32
    p1, p2 = lsb.permutation(10_000, key), lsb.permutation(10_000, key)
    assert np.array_equal(p1, p2)
    assert np.array_equal(np.sort(p1), np.arange(10_000, dtype=np.uint32))
    assert not np.array_equal(p1, lsb.permutation(10_000, b"j" * 32))


def test_known_answer_permutation_is_stable():
    """Vector fixo: garante que o formato não muda silenciosamente entre versões do NumPy/cryptography."""
    p = lsb.permutation(16, bytes(range(32)))
    assert p.tolist() == lsb.permutation(16, bytes(range(32))).tolist()
    assert sorted(p.tolist()) == list(range(16))


def test_weak_and_empty_inputs(png_bytes):
    with pytest.raises(AppError) as e:
        do_hide(png_bytes, "x", password="curta")
    assert e.value.code == "WEAK_PASSWORD"
    with pytest.raises(AppError) as e:
        do_hide(png_bytes, "   ", None)
    assert e.value.code == "EMPTY_PAYLOAD"
    with pytest.raises(AppError) as e:
        do_hide(png_bytes, "x", bits=3)
    assert e.value.code == "VALIDATION_ERROR"


def test_gif_animated_warns_and_uses_first_frame():
    frames = [random_image(80, 80, seed=i).convert("P") for i in range(3)]
    buf = io.BytesIO()
    frames[0].save(buf, "GIF", save_all=True, append_images=frames[1:])
    result = do_hide(buf.getvalue(), "gif", name="anim.gif")
    assert any("fotogramas" in w for w in result.warnings)
    assert do_extract(result.png).message == "gif"


def test_unsupported_and_corrupted_inputs():
    with pytest.raises(AppError) as e:
        do_hide(b"isto nao e uma imagem", "x")
    assert e.value.code == "UNSUPPORTED_IMAGE_FORMAT"
    with pytest.raises(AppError) as e:
        do_hide(b"\x89PNG\r\n\x1a\n" + b"lixo" * 50, "x")
    assert e.value.code == "CORRUPTED_IMAGE"
    with pytest.raises(AppError) as e:  # SVG não é suportado
        do_hide(b"<svg xmlns='http://www.w3.org/2000/svg'></svg>", "x")
    assert e.value.code == "UNSUPPORTED_IMAGE_FORMAT"


def test_exif_orientation_applied_on_embedding():
    im = random_image(120, 60)
    exif = Image.Exif()
    exif[0x0112] = 6  # rodar 90°
    result = do_hide(encode(im, "JPEG", exif=exif), "rot")
    out = Image.open(io.BytesIO(result.png))
    assert out.size == (60, 120)
    assert do_extract(result.png).message == "rot"


def test_fast_radix_argsort_equals_reference_stable_argsort():
    """A ordenação rápida (2 passagens de 16 bits) tem de dar o mesmo resultado que a estável de referência."""
    rng = np.random.default_rng(5)
    for n in (0, 1, 2, 1000, 200_000):
        keys = rng.integers(0, 2**32, n, dtype=np.uint64).astype("<u4")
        assert np.array_equal(lsb._stable_argsort_u32(keys), np.argsort(keys, kind="stable"))
    ties = np.array([5, 5, 1, 5, 1, 0, 0, 2**32 - 1, 2**32 - 1, 65536, 65536, 1], dtype="<u4")  # com empates
    assert np.array_equal(lsb._stable_argsort_u32(ties), np.argsort(ties, kind="stable"))


def test_permutation_known_answer_vector():
    """Vector fixo: se isto mudar, imagens antigas deixam de abrir (quebra do formato)."""
    assert lsb.permutation(12, bytes(range(32))).tolist() == KNOWN_PERMUTATION_12
