"""Pacote interno e nomes: Zip Slip, zip bombs, nomes perigosos (teste 8 do enunciado)."""

from __future__ import annotations

import io
import json
import zipfile

import pytest

from app.bundle.package import MANIFEST_NAME, PackedFile, build_package, parse_package
from app.core.errors import AppError
from app.core.filenames import content_disposition, make_output_name, sanitize_filename

LIMITS = dict(max_files=5, max_total_bytes=1_000_000)


def _zip(entries: dict[str, bytes], compression=zipfile.ZIP_STORED) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=compression) as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()


def _manifest(files: list[dict], message=None) -> bytes:
    return json.dumps({"v": 1, "message": message, "files": files}).encode()


def _sha(data: bytes) -> str:
    import hashlib

    return hashlib.sha256(data).hexdigest()


def test_valid_package_round_trip():
    pkg = parse_package(build_package("m", [PackedFile("a/b\\c.txt", b"123")]), **LIMITS)
    assert pkg.message == "m" and pkg.files[0].name == "c.txt" and pkg.files[0].data == b"123"


def test_zip_slip_names_inside_zip_are_rejected():
    data = b"evil"
    entries = {
        MANIFEST_NAME: _manifest([{"id": "0001", "name": "../../evil.txt", "size": 4, "sha256": _sha(data), "mime": "text/plain"}]),
        "../../evil.txt": data,
    }
    with pytest.raises(AppError) as e:
        parse_package(_zip(entries), **LIMITS)
    assert e.value.code == "ATTACHMENT_RECOVERY_FAILED"


def test_manifest_traversal_name_is_sanitised_not_used_as_path():
    data = b"x"
    entries = {
        MANIFEST_NAME: _manifest([{"id": "0001", "name": "../../../Windows/system32/evil.dll", "size": 1, "sha256": _sha(data), "mime": "x/y"}]),
        "files/0001.bin": data,
    }
    pkg = parse_package(_zip(entries), **LIMITS)
    assert pkg.files[0].name == "evil.dll"


def test_manifest_id_cannot_point_outside_files_dir():
    data = b"x"
    entries = {
        MANIFEST_NAME: _manifest([{"id": "../x", "name": "a", "size": 1, "sha256": _sha(data), "mime": "x/y"}]),
        "files/../x.bin": data,
    }
    with pytest.raises(AppError):
        parse_package(_zip(entries), **LIMITS)


def test_zip_bomb_compressed_entry_rejected():
    bomb = b"\0" * 50_000_000
    data = _zip({MANIFEST_NAME: _manifest([{"id": "0001", "name": "b", "size": len(bomb), "sha256": _sha(bomb), "mime": "x/y"}]),
                 "files/0001.bin": bomb}, compression=zipfile.ZIP_DEFLATED)
    assert len(data) < 100_000  # razão de compressão enorme
    with pytest.raises(AppError) as e:
        parse_package(data, **LIMITS)
    assert e.value.code == "ATTACHMENT_RECOVERY_FAILED"


def test_declared_total_over_limit_rejected():
    big = b"\0" * 2000
    entries = {MANIFEST_NAME: _manifest([{"id": "0001", "name": "b", "size": 2000, "sha256": _sha(big), "mime": "x/y"}]),
               "files/0001.bin": big}
    with pytest.raises(AppError):
        parse_package(_zip(entries), max_files=5, max_total_bytes=1000)


def test_too_many_entries_rejected():
    entries = {MANIFEST_NAME: _manifest([])}
    entries.update({f"files/{i:04d}.bin": b"x" for i in range(1, 20)})
    with pytest.raises(AppError):
        parse_package(_zip(entries), **LIMITS)


def test_extra_undeclared_entry_rejected():
    entries = {MANIFEST_NAME: _manifest([]), "files/0001.bin": b"x"}
    with pytest.raises(AppError):
        parse_package(_zip(entries), **LIMITS)


def test_sha256_mismatch_rejected():
    entries = {MANIFEST_NAME: _manifest([{"id": "0001", "name": "a", "size": 1, "sha256": "0" * 64, "mime": "x/y"}]),
               "files/0001.bin": b"x"}
    with pytest.raises(AppError) as e:
        parse_package(_zip(entries), **LIMITS)
    assert e.value.code == "ATTACHMENT_RECOVERY_FAILED"


def test_garbage_is_not_a_package():
    with pytest.raises(AppError):
        parse_package(b"not a zip at all", **LIMITS)


def test_duplicate_names_are_made_unique():
    pkg = parse_package(build_package(None, [PackedFile("a.txt", b"1"), PackedFile("A.TXT", b"2"), PackedFile("a.txt", b"3")]), **LIMITS)
    assert len({f.name.lower() for f in pkg.files}) == 3


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("../../etc/passwd", "passwd"),
        ("C:\\Windows\\System32\\cmd.exe", "cmd.exe"),
        ("CON", "_CON"),
        ("nul.txt", "_nul.txt"),
        ("COM1.log", "_COM1.log"),
        ("", "ficheiro"),
        ("   ...  ", "ficheiro"),
        ("a<b>c:d\"e|f?g*.txt", "a_b_c_d_e_f_g_.txt"),
        ("rel\u202eatad.exe", "relatad.exe"),  # sobreposição bidi removida
        ("zero\u200bwidth.txt", "zerowidth.txt"),
        ("ficheiro\x00.txt", "ficheiro.txt"),
    ],
)
def test_sanitize_filename(raw, expected):
    assert sanitize_filename(raw) == expected


def test_sanitize_filename_limits_length():
    name = sanitize_filename("x" * 500 + ".pdf")
    assert len(name) <= 100 and name.endswith(".pdf")


def test_output_name_prefix_and_extension():
    n = make_output_name("foto_praia.jpg")
    prefix, rest = n.split("_", 1)
    assert len(prefix) == 4 and prefix.isalnum() and prefix == prefix.lower()
    assert rest == "foto_praia.png"
    assert make_output_name(None).endswith("_imagem.png")
    assert make_output_name("../../x/y.jpeg").endswith("_y.png")
    assert make_output_name("a" * 300 + ".png").endswith(".png") and len(make_output_name("a" * 300)) <= 105


def test_content_disposition_rfc5987_has_no_injection():
    header = content_disposition('evil"; filename="x.exe\r\nSet-Cookie: a=b.png')
    assert "\r" not in header and "\n" not in header
    assert "filename*=UTF-8''" in header
    assert 'filename="evil"' not in header.split("filename*")[0].replace('evil_"', "")
    cd = content_disposition("açaí café.png")
    assert "filename*=UTF-8''a%C3%A7a%C3%AD%20caf%C3%A9.png" in cd
