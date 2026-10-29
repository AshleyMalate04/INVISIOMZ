"""API: health, capacity, hide, extract, erros, JWT, rate limiting, limites e logs (testes 9, 11 e 13)."""

from __future__ import annotations

import base64
import io
import json
import logging
import time
from urllib.parse import unquote

import jwt
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import create_app

from .conftest import JWT_SECRET, PASSWORD, encode, make_settings, make_token, random_image


def hide(client, png, *, message="olá", files=None, password=PASSWORD, bits=1, headers=None, name="foto.jpg", **form):
    data = {"password": password, "bits": str(bits), **form}
    if message is not None:
        data["message"] = message
    multipart = [("image", (name, png, "image/png"))]
    for fname, content in files or []:
        multipart.append(("files", (fname, content, "application/octet-stream")))
    return client.post("/api/hide", data=data, files=multipart, headers=headers or {})


def extract(client, png, password=PASSWORD, headers=None):
    return client.post("/api/extract", data={"password": password}, files={"image": ("x.png", png, "image/png")}, headers=headers or {})


# -- sistema ------------------------------------------------------------------------------------
def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok" and r.json()["supabase"] == "not_configured"
    assert set(r.json()) == {"status", "version", "supabase"}  # sem detalhes de ligação


def test_config_public_limits(client):
    j = client.get("/api/config").json()
    assert j["limits"]["password_min_length"] == 10 and j["accounts_enabled"] is False


def test_security_headers_and_request_id(client):
    r = client.get("/api/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["referrer-policy"] == "no-referrer"
    assert r.headers["cache-control"] == "no-store"
    assert "default-src 'none'" in r.headers["content-security-policy"]
    assert len(r.headers["x-request-id"]) >= 8


def test_cors_allows_only_listed_origins(client):
    ok = client.options("/api/hide", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    bad = client.options("/api/hide", headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in bad.headers


def test_unknown_route_uses_error_format(client):
    r = client.get("/api/nao-existe")
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"


# -- capacity -----------------------------------------------------------------------------------
def test_capacity(client):
    png = encode(random_image(1000, 800), "PNG")
    r = client.post("/api/capacity", data={"bits": "1"}, files={"image": ("a.png", png, "image/png")})
    assert r.status_code == 200
    j = r.json()
    assert (j["width"], j["height"], j["format"]) == (1000, 800, "PNG")
    assert j["raw_capacity_bytes"] == 1000 * 800 * 3 // 8
    assert j["modes"]["2"]["raw_capacity_bytes"] == 2 * j["modes"]["1"]["raw_capacity_bytes"]
    assert j["useful_capacity_bytes"] < j["raw_capacity_bytes"]
    assert j["original_size_bytes"] == len(png)


def test_capacity_gif_warning(client):
    frames = [random_image(40, 40, seed=i).convert("P") for i in range(2)]
    buf = io.BytesIO()
    frames[0].save(buf, "GIF", save_all=True, append_images=frames[1:])
    r = client.post("/api/capacity", data={"bits": "1"}, files={"image": ("a.gif", buf.getvalue(), "image/gif")})
    assert any("fotogramas" in w for w in r.json()["warnings"])


# -- hide + extract ----------------------------------------------------------------------------------------
def test_hide_returns_real_png_with_headers_and_extract_round_trip(client, png_bytes):
    r = hide(client, png_bytes, message="Olá 🚀", files=[("nota ç.txt", "conteúdo".encode()), ("b.bin", b"\x00\x01\x02")])
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert r.content.startswith(b"\x89PNG") and Image.open(io.BytesIO(r.content)).format == "PNG"
    name = unquote(r.headers["x-output-filename"])
    assert name.endswith("_foto.png") and name[4] == "_"
    assert "filename*=UTF-8''" in r.headers["content-disposition"]
    assert (r.headers["x-image-width"], r.headers["x-image-height"]) == ("200", "150")
    assert int(r.headers["x-output-size"]) == len(r.content) and int(r.headers["x-original-size"]) == len(png_bytes)
    import hashlib

    assert r.headers["x-output-sha256"] == hashlib.sha256(r.content).hexdigest()
    meta = json.loads(unquote(r.headers["x-meta"]))
    assert meta["file_count"] == 2 and meta["has_message"] is True
    assert r.headers["x-saved"] == "false"

    e = extract(client, r.content)
    assert e.status_code == 200
    j = e.json()
    assert j["message"] == "Olá 🚀" and j["inline"] is True
    assert [f["name"] for f in j["files"]] == ["nota ç.txt", "b.bin"]
    assert base64.b64decode(j["files"][0]["content_b64"]) == "conteúdo".encode()
    # ZIP de uso único
    z = client.get(f"/api/files/{j['zip_token']}")
    assert z.status_code == 200 and z.headers["content-type"] == "application/zip"
    import zipfile

    names = zipfile.ZipFile(io.BytesIO(z.content)).namelist()
    assert "mensagem.txt" in names and "nota ç.txt" in names
    again = client.get(f"/api/files/{j['zip_token']}")
    assert again.status_code == 404 and again.json()["error"]["code"] == "NOT_FOUND"


def test_large_extraction_uses_single_use_tokens():
    s = make_settings(extract_inline_max_bytes=100)
    with TestClient(create_app(s)) as c:
        payload = b"A" * 5000
        r = hide(c, encode(random_image(300, 300), "PNG"), files=[("grande.bin", payload)])
        j = extract(c, r.content).json()
        assert j["inline"] is False and j["files"][0]["content_b64"] is None
        got = c.get(f"/api/files/{j['files'][0]['download_token']}")
        assert got.content == payload and got.headers["content-type"] == "application/octet-stream"
        assert "attachment" in got.headers["content-disposition"]
        assert c.get(f"/api/files/{j['files'][0]['download_token']}").status_code == 404


def test_extract_wrong_password_and_no_data(client, png_bytes):
    stego = hide(client, png_bytes).content
    r = extract(client, stego, password="senha-errada-123")
    assert r.status_code == 400 and r.json()["error"]["code"] == "WRONG_PASSWORD_OR_TAMPERED"
    assert "correlation_id" in r.json()["error"]
    assert "message" not in r.json()  # nada é revelado
    r = extract(client, png_bytes)
    assert r.json()["error"]["code"] == "NO_HIDDEN_DATA"


def test_error_codes_http_status(client, png_bytes):
    assert hide(client, png_bytes, password="curta").status_code == 422
    assert hide(client, png_bytes, password="curta").json()["error"]["code"] == "WEAK_PASSWORD"
    assert hide(client, png_bytes, message=None).json()["error"]["code"] == "EMPTY_PAYLOAD"
    assert hide(client, b"nao imagem").status_code == 415
    assert hide(client, png_bytes, bits=3).json()["error"]["code"] == "VALIDATION_ERROR"
    r = hide(client, encode(random_image(20, 20), "PNG"), files=[("x.bin", b"0" * 4000)])
    assert r.status_code == 400 and r.json()["error"]["code"] == "CAPACITY_EXCEEDED"
    assert r.json()["error"]["details"]["needed_bytes"] > r.json()["error"]["details"]["useful_capacity_bytes"]


def test_validation_error_never_echoes_password(client, png_bytes):
    r = client.post("/api/hide", data={"password": "SenhaSecreta-9876", "bits": "abc"}, files={"image": ("a.png", png_bytes)})
    assert r.status_code == 422
    assert "SenhaSecreta-9876" not in r.text
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


# -- limites -----------------------------------------------------------------------------------------------
def test_too_many_pixels_rejected():
    s = make_settings(max_image_pixels=10_000)
    with TestClient(create_app(s)) as c:
        r = hide(c, encode(random_image(200, 200), "PNG"))
        assert r.status_code == 413 and r.json()["error"]["code"] == "FILE_TOO_LARGE"


def test_decompression_bomb_png_rejected():
    s = make_settings(max_image_pixels=1_000_000)
    huge = Image.new("L", (20_000, 20_000))  # 400 MP, comprime para quase nada
    with TestClient(create_app(s)) as c:
        r = hide(c, encode(huge, "PNG"))
        assert r.status_code == 413


def test_upload_limits():
    s = make_settings(max_image_bytes=2000, max_files=2, max_file_bytes=100, max_total_bytes=150, max_request_bytes=500_000)
    with TestClient(create_app(s)) as c:
        png = encode(random_image(30, 30), "PNG")
        assert len(png) > 2000
        assert hide(c, png).status_code == 413  # imagem demasiado grande
        small = encode(Image.new("RGB", (10, 10)), "PNG")
        assert len(small) < 2000
        assert hide(c, small, files=[("a", b"x"), ("b", b"y"), ("c", b"z")]).status_code == 413  # nº de ficheiros
        assert hide(c, small, files=[("a", b"x" * 101)]).status_code == 413  # ficheiro
        assert hide(c, small, files=[("a", b"x" * 90), ("b", b"y" * 90)]).status_code == 413  # total


def test_request_body_cap_content_length_and_streaming():
    s = make_settings(max_request_bytes=10_000)
    with TestClient(create_app(s)) as c:
        r = c.post("/api/hide", content=b"x" * 20_000, headers={"content-type": "multipart/form-data; boundary=x"})
        assert r.status_code == 413 and r.json()["error"]["code"] == "FILE_TOO_LARGE"

        def chunks():  # sem Content-Length (chunked)
            for _ in range(5):
                yield b"y" * 4_000

        r = c.post("/api/hide", content=chunks(), headers={"content-type": "multipart/form-data; boundary=x"})
        assert r.status_code == 413


def test_message_too_long_rejected():
    s = make_settings(max_message_chars=50)
    with TestClient(create_app(s)) as c:
        assert hide(c, encode(random_image(), "PNG"), message="x" * 51).status_code == 413


# -- JWT -------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize(
    "token",
    [
        "isto.nao.eum-jwt",
        make_token(exp_in=-10),
        make_token(aud="outro"),
        make_token(secret="chave-errada-com-mais-de-32-caracteres!!"),
        jwt.encode({"sub": "x", "aud": "authenticated"}, "", algorithm="none"),
    ],
    ids=["lixo", "expirado", "audiencia-errada", "assinatura-errada", "alg-none"],
)
def test_invalid_jwt_is_401(client, png_bytes, token):
    r = hide(client, png_bytes, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHORIZED"
    assert client.get("/api/history", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_missing_jwt_guest_allowed_but_history_requires_auth(client, png_bytes):
    assert hide(client, png_bytes).status_code == 200
    assert client.get("/api/history").status_code == 401
    assert client.delete("/api/account").status_code == 401
    assert client.get("/api/history", headers={"Authorization": "Basic abc"}).status_code == 401


def test_valid_jwt_accepted_but_history_unavailable_without_supabase(client):
    r = client.get("/api/history", headers={"Authorization": f"Bearer {make_token()}"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "SERVICE_UNAVAILABLE"


def test_save_to_history_requires_login(client, png_bytes):
    assert hide(client, png_bytes, save_to_history="true").status_code == 401


# -- rate limiting -----------------------------------------------------------------------------------------------
def test_rate_limit_on_extract():
    s = make_settings(rate_limit_enabled=True, rate_extract_per_min=3, extract_fail_threshold=100)
    with TestClient(create_app(s)) as c:
        png = encode(random_image(60, 60), "PNG")
        codes = [extract(c, png).status_code for _ in range(5)]
        assert codes[:3] == [400, 400, 400] and codes[3:] == [429, 429]
        r = extract(c, png)
        assert r.json()["error"]["code"] == "RATE_LIMITED" and int(r.headers["retry-after"]) >= 1


def test_backoff_after_repeated_wrong_passwords():
    s = make_settings(rate_limit_enabled=False, extract_fail_threshold=3, extract_lock_base_s=30)
    with TestClient(create_app(s)) as c:
        stego = hide(c, encode(random_image(), "PNG")).content
        for _ in range(3):
            assert extract(c, stego, "senha-errada-xyz").status_code == 400
        locked = extract(c, stego, PASSWORD)  # até a senha certa fica bloqueada durante o backoff
        assert locked.status_code == 429 and int(locked.headers["retry-after"]) > 0


def test_success_resets_failure_counter():
    s = make_settings(extract_fail_threshold=3)
    with TestClient(create_app(s)) as c:
        stego = hide(c, encode(random_image(), "PNG")).content
        for _ in range(2):
            extract(c, stego, "senha-errada-xyz")
        assert extract(c, stego, PASSWORD).status_code == 200
        for _ in range(2):
            assert extract(c, stego, "senha-errada-xyz").status_code == 400


# -- logs -------------------------------------------------------------------------------------------------------------
def test_logs_never_contain_password_message_or_filenames(client, png_bytes, caplog):
    secret_pw, secret_msg, secret_file = "SenhaMuitoSecreta#777", "MENSAGEM-ULTRA-SECRETA", "ficheiro-confidencial.pdf"
    with caplog.at_level(logging.DEBUG):
        r = hide(client, png_bytes, message=secret_msg, password=secret_pw, files=[(secret_file, b"%PDF-1.4")])
        extract(client, r.content, secret_pw)
        extract(client, r.content, "errada-errada-errada")
        client.post("/api/hide", data={"password": secret_pw}, files={"image": ("a.png", b"lixo")})
    blob = "\n".join(
        f"{rec.getMessage()} {getattr(rec, '__dict__', {})}" for rec in caplog.records
    )
    assert caplog.records, "o teste só é válido se houver logs capturados"
    for secret in (secret_pw, secret_msg, secret_file, base64.b64encode(secret_msg.encode()).decode()):
        assert secret not in blob


def test_json_log_formatter_output_has_no_extra_fields(capsys):
    from app.core.logging import JsonFormatter

    rec = logging.LogRecord("x", logging.INFO, __file__, 1, "msg", None, None)
    rec.password = "NAO-DEVE-APARECER"  # campos fora da lista branca nunca são emitidos
    rec.status = 200
    out = json.loads(JsonFormatter().format(rec))
    assert "password" not in out and out["status"] == 200


def test_internal_error_is_generic_with_correlation_id(png_bytes, monkeypatch):
    from app.services import hide_service

    def boom(**_):
        raise RuntimeError("detalhe interno /caminho/secreto C:\\dados")

    monkeypatch.setattr(hide_service, "hide", boom)
    with TestClient(create_app(make_settings()), raise_server_exceptions=False) as c:
        r = hide(c, png_bytes)
    assert r.status_code == 500
    body = r.json()["error"]
    assert body["code"] == "INTERNAL_ERROR" and body["correlation_id"]
    assert "secreto" not in r.text and "Traceback" not in r.text


def test_heavy_jobs_are_limited_to_max_concurrent_jobs(png_bytes, monkeypatch):
    """Com `max_concurrent_jobs=1` dois pedidos simultâneos nunca correm ao mesmo tempo (limita a RAM)."""
    import threading
    from concurrent.futures import ThreadPoolExecutor

    from app.services import hide_service as hs

    real = hs.hide
    running = {"now": 0, "max": 0}
    lock = threading.Lock()

    def tracked(**kw):
        with lock:
            running["now"] += 1
            running["max"] = max(running["max"], running["now"])
        time.sleep(0.25)
        try:
            return real(**kw)
        finally:
            with lock:
                running["now"] -= 1

    monkeypatch.setattr(hs, "hide", tracked)
    with TestClient(create_app(make_settings(max_concurrent_jobs=1))) as c:
        with ThreadPoolExecutor(3) as ex:
            codes = list(ex.map(lambda _: hide(c, png_bytes).status_code, range(3)))
    assert codes == [200, 200, 200] and running["max"] == 1


def test_es256_jwt_validated_through_jwks_path(png_bytes, monkeypatch):
    """Caminho assimétrico (Supabase com chaves de assinatura ES256 via JWKS): assinatura, `aud` e `exp` são verificados."""
    from cryptography.hazmat.primitives.asymmetric import ec

    key = ec.generate_private_key(ec.SECP256R1())
    other = ec.generate_private_key(ec.SECP256R1())
    now = int(time.time())

    def token(signing_key, aud="authenticated", exp=3600):
        return jwt.encode({"sub": "u-es256", "aud": aud, "role": "authenticated", "exp": now + exp}, signing_key, algorithm="ES256", headers={"kid": "k1"})

    class FakeJwks:
        def get_signing_key_from_jwt(self, _token):
            class K:
                pass

            k = K()
            k.key = key.public_key()
            return k

    s = make_settings(supabase_url="http://supabase.test", supabase_anon_key="a", supabase_service_role_key="s", supabase_jwt_secret="")
    with TestClient(create_app(s, gateway=__import__("tests.fakes", fromlist=["x"]).FakeGateway())) as c:
        monkeypatch.setattr(c.app.state.verifier, "_jwks", FakeJwks())
        ok = c.get("/api/history", headers={"Authorization": f"Bearer {token(key)}"})
        assert ok.status_code == 200  # assinado pela chave certa
        for bad in (token(other), token(key, aud="x"), token(key, exp=-5)):
            assert c.get("/api/history", headers={"Authorization": f"Bearer {bad}"}).status_code == 401
        # HS256 recusado quando não há segredo configurado (evita confusão de algoritmo)
        hs = jwt.encode({"sub": "x", "aud": "authenticated", "exp": now + 60}, "qualquer-segredo-com-mais-de-32-bytes!!", algorithm="HS256")
        assert c.get("/api/history", headers={"Authorization": f"Bearer {hs}"}).status_code == 401




@pytest.mark.parametrize(
    "xff,hops,expected",
    [
        ("9.9.9.9", 1, "9.9.9.9"),
        ("6.6.6.6, 9.9.9.9", 1, "9.9.9.9"),  # a parte da esquerda foi inventada pelo cliente
        ("6.6.6.6, 9.9.9.9, 10.0.0.2", 2, "9.9.9.9"),  # dois proxies de confiança
        ("9.9.9.9", 2, "9.9.9.9"),  # menos entradas do que saltos: usa a primeira
    ],
)
def test_client_ip_uses_rightmost_trusted_hop(xff, hops, expected):
    from starlette.requests import Request

    from app.core.ratelimit import client_ip

    scope = {"type": "http", "headers": [(b"x-forwarded-for", xff.encode())], "client": ("10.0.0.1", 1234)}
    assert client_ip(Request(scope), True, hops) == expected
    assert client_ip(Request(scope), False, hops) == "10.0.0.1"  # sem confiança no proxy ignora o cabeçalho


def test_spoofed_xff_does_not_bypass_rate_limit():
    s = make_settings(rate_limit_enabled=True, rate_extract_per_min=2, extract_fail_threshold=100, trust_proxy_headers=True)
    with TestClient(create_app(s)) as c:
        png = encode(random_image(60, 60), "PNG")
        codes = []
        for i in range(4):  # o atacante muda o início do cabeçalho; o fim (visto pelo proxy) é sempre o mesmo
            r = c.post("/api/extract", data={"password": "x"}, files={"image": ("a.png", png)},
                       headers={"X-Forwarded-For": f"1.1.1.{i}, 9.9.9.9"})
            codes.append(r.status_code)
        assert codes == [400, 400, 429, 429]
