"""Integração com o Supabase LOCAL real (RLS, Storage, URLs assinadas, limpeza).

Só corre se o Supabase local estiver acessível. Variáveis (saída de `npx supabase status -o env`):
    SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET
Sem elas (ou sem ligação), os testes são SALTADOS — e isso aparece no relatório como «skipped», não como «passed».
"""

from __future__ import annotations

import os
import time
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import create_app

from .conftest import encode, make_settings, random_image
from .test_api import extract, hide

URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
ANON = os.environ.get("SUPABASE_ANON_KEY", "")
SERVICE = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")


def _reachable() -> bool:
    if not (URL and ANON and SERVICE):
        return False
    try:
        return httpx.get(f"{URL}/auth/v1/health", headers={"apikey": ANON}, timeout=3).status_code < 500
    except httpx.HTTPError:
        return False


pytestmark = pytest.mark.skipif(not _reachable(), reason="Supabase local indisponível (defina SUPABASE_* e corra `supabase start`)")

PW = "senha-de-teste-integracao-1"


def service_headers() -> dict[str, str]:
    if SERVICE.startswith("sb_secret_"):  # chaves novas: não são JWT, só vão em `apikey`
        return {"apikey": SERVICE}
    return {"apikey": SERVICE, "Authorization": f"Bearer {SERVICE}"}


def create_user() -> tuple[str, str]:
    email = f"it-{uuid.uuid4().hex[:10]}@example.com"
    r = httpx.post(f"{URL}/auth/v1/admin/users", headers=service_headers(), json={"email": email, "password": PW, "email_confirm": True})
    assert r.status_code in (200, 201), r.text
    uid = r.json()["id"]
    t = httpx.post(f"{URL}/auth/v1/token?grant_type=password", headers={"apikey": ANON}, json={"email": email, "password": PW})
    assert t.status_code == 200, t.text
    return uid, t.json()["access_token"]


def user_headers(token: str) -> dict[str, str]:
    return {"apikey": ANON, "Authorization": f"Bearer {token}"}


def purge_user(uid: str) -> None:
    """Apaga os objectos do utilizador no Storage e depois o próprio utilizador (nada fica órfão)."""
    listing = httpx.post(f"{URL}/storage/v1/object/list/stego-results", headers=service_headers(), json={"prefix": uid, "limit": 1000})
    names = [f"{uid}/{o['name']}" for o in (listing.json() if listing.status_code == 200 else [])]
    if names:
        httpx.request("DELETE", f"{URL}/storage/v1/object/stego-results", headers=service_headers(), json={"prefixes": names})
    httpx.delete(f"{URL}/auth/v1/admin/users/{uid}", headers=service_headers())


@pytest.fixture(scope="module")
def users():
    a, b = create_user(), create_user()
    yield {"a": a, "b": b}
    for uid, _ in (a, b):
        purge_user(uid)


@pytest.fixture
def client():
    s = make_settings(supabase_url=URL, supabase_anon_key=ANON, supabase_service_role_key=SERVICE, supabase_jwt_secret=SECRET)
    with TestClient(create_app(s)) as c:
        yield c


@pytest.fixture
def saved(client, users):
    uid, token = users["a"]
    r = hide(client, encode(random_image(), "PNG"), headers={"Authorization": f"Bearer {token}"}, save_to_history="true")
    assert r.status_code == 200, r.text
    return r.json()


def test_health_reports_supabase_ok(client):
    assert client.get("/api/health").json()["supabase"] == "ok"


def test_profile_created_on_signup(users):
    uid, token = users["a"]
    rows = httpx.get(f"{URL}/rest/v1/profiles?select=id", headers=user_headers(token)).json()
    assert [r["id"] for r in rows] == [uid]


def test_save_flow_and_signed_url_expires(client, users, saved):
    uid, token = users["a"]
    url = saved["signed_url"]
    ok = httpx.get(url)
    assert ok.status_code == 200 and ok.content.startswith(b"\x89PNG")
    # URL assinado com validade curtíssima (2 s) deixa de funcionar
    path = httpx.get(f"{URL}/rest/v1/stego_files?select=storage_path", headers=user_headers(token)).json()[0]["storage_path"]
    short = httpx.post(f"{URL}/storage/v1/object/sign/stego-results/{path}", headers=service_headers(), json={"expiresIn": 2}).json()["signedURL"]
    short_url = f"{URL}/storage/v1{short}"
    assert httpx.get(short_url).status_code == 200
    time.sleep(3.5)
    assert httpx.get(short_url).status_code in (400, 401, 403)


def test_rls_user_b_cannot_read_or_delete_user_a(client, users, saved):
    _, tok_a = users["a"]
    uid_b, tok_b = users["b"]
    hb = user_headers(tok_b)
    # PostgREST como B: vê zero linhas de A
    for table in ("operations", "stego_files"):
        assert httpx.get(f"{URL}/rest/v1/{table}?select=*", headers=hb).json() == []
    prof = httpx.get(f"{URL}/rest/v1/profiles?select=id", headers=hb).json()
    assert [p["id"] for p in prof] == [uid_b]
    # DELETE como B não apaga nada de A
    gone = httpx.delete(f"{URL}/rest/v1/operations?id=eq.{saved['operation_id']}", headers={**hb, "Prefer": "return=representation"})
    assert gone.json() == []
    assert len(httpx.get(f"{URL}/rest/v1/operations?select=id", headers=user_headers(tok_a)).json()) >= 1
    # Storage: B não consegue obter o objecto de A
    path = httpx.get(f"{URL}/rest/v1/stego_files?select=storage_path", headers=user_headers(tok_a)).json()[0]["storage_path"]
    assert httpx.get(f"{URL}/storage/v1/object/authenticated/stego-results/{path}", headers=hb).status_code in (400, 401, 403, 404)
    assert httpx.get(f"{URL}/storage/v1/object/public/stego-results/{path}").status_code in (400, 401, 403, 404)  # bucket privado


def test_authenticated_users_cannot_write_operations_or_files_directly(users):
    uid, token = users["a"]
    h = {**user_headers(token), "Content-Type": "application/json"}
    row = {"user_id": uid, "type": "hide", "status": "success"}
    assert httpx.post(f"{URL}/rest/v1/operations", headers=h, json=row).status_code in (401, 403)
    assert httpx.post(f"{URL}/rest/v1/audit_log", headers=h, json={"event": "x_event"}).status_code in (401, 403)
    assert httpx.get(f"{URL}/rest/v1/audit_log?select=*", headers=h).status_code in (401, 403, 200)
    r = httpx.get(f"{URL}/rest/v1/audit_log?select=*", headers=h)
    assert r.status_code != 200 or r.json() == []
    # anónimo não lê nada
    anon = httpx.get(f"{URL}/rest/v1/operations?select=*", headers={"apikey": ANON})
    assert anon.status_code in (401, 403) or anon.json() == []


def test_storage_policies_block_direct_upload_by_users(users):
    uid, token = users["a"]
    r = httpx.post(f"{URL}/storage/v1/object/stego-results/{uid}/{uuid.uuid4()}.png", headers={**user_headers(token), "Content-Type": "image/png"}, content=b"x")
    assert r.status_code in (400, 401, 403)


def test_bucket_is_private_png_only(users):
    uid, _ = users["a"]
    b = httpx.get(f"{URL}/storage/v1/bucket/stego-results", headers=service_headers()).json()
    assert b["public"] is False and b["allowed_mime_types"] == ["image/png"] and b["file_size_limit"] >= 50 * 1024 * 1024
    bad = httpx.post(f"{URL}/storage/v1/object/stego-results/{uid}/{uuid.uuid4()}.png", headers={**service_headers(), "Content-Type": "text/plain"}, content=b"not a png")
    assert bad.status_code in (400, 415)


def test_operations_never_contain_content(client, users):
    uid, token = users["a"]
    secret = "MENSAGEM-ULTRA-SECRETA-INTEGRACAO"
    r = hide(client, encode(random_image(), "PNG"), message=secret, files=[("confidencial.pdf", b"%PDF")], headers={"Authorization": f"Bearer {token}"})
    extract(client, r.content, "errada-errada-12", headers={"Authorization": f"Bearer {token}"})
    rows = httpx.get(f"{URL}/rest/v1/operations?select=*", headers=user_headers(token)).text
    for forbidden in (secret, "confidencial", "senha", "errada-errada"):
        assert forbidden not in rows


def test_cleanup_removes_expired_objects_and_rows(client, users, saved):
    uid, token = users["a"]
    row = httpx.get(f"{URL}/rest/v1/stego_files?select=id,storage_path", headers=user_headers(token)).json()[0]
    httpx.patch(f"{URL}/rest/v1/stego_files?id=eq.{row['id']}", headers={**service_headers(), "Content-Type": "application/json"},
                json={"expires_at": "2020-01-01T00:00:00Z"})
    removed = client.portal.call(client.app.state.history.cleanup_expired)  # no mesmo event loop da app
    assert removed >= 1
    assert httpx.get(f"{URL}/rest/v1/stego_files?id=eq.{row['id']}&select=id", headers=service_headers()).json() == []
    obj = httpx.get(f"{URL}/storage/v1/object/stego-results/{row['storage_path']}", headers=service_headers())
    assert obj.status_code in (400, 404)


def test_delete_account_removes_user_and_data(client):
    uid, token = create_user()
    hide(client, encode(random_image(), "PNG"), headers={"Authorization": f"Bearer {token}"}, save_to_history="true")
    path = httpx.get(f"{URL}/rest/v1/stego_files?select=storage_path", headers=user_headers(token)).json()[0]["storage_path"]
    assert client.delete("/api/account", headers={"Authorization": f"Bearer {token}"}).status_code == 204
    assert httpx.get(f"{URL}/rest/v1/operations?user_id=eq.{uid}&select=id", headers=service_headers()).json() == []
    assert httpx.get(f"{URL}/rest/v1/profiles?id=eq.{uid}&select=id", headers=service_headers()).json() == []
    assert httpx.get(f"{URL}/storage/v1/object/stego-results/{path}", headers=service_headers()).status_code in (400, 404)


def test_login_required_and_dashboard_with_real_supabase(users, saved):
    """Modo convidado desligado (por defeito) + painel lido sob RLS: cada utilizador só vê o seu resumo."""
    s = make_settings(allow_guest=False, supabase_url=URL, supabase_anon_key=ANON, supabase_service_role_key=SERVICE, supabase_jwt_secret=SECRET)
    _, tok_a = users["a"]
    _, tok_b = users["b"]
    with TestClient(create_app(s)) as c:
        png = encode(random_image(), "PNG")
        assert hide(c, png).status_code == 401
        assert c.get("/api/dashboard").status_code == 401
        da = c.get("/api/dashboard", headers={"Authorization": f"Bearer {tok_a}"}).json()
        db = c.get("/api/dashboard", headers={"Authorization": f"Bearer {tok_b}"}).json()
        assert da["totals"]["hide"] >= 1 and da["saved"]["count"] >= 1 and da["recent"][0]["type"] in {"hide", "extract"}
        assert db["totals"]["operations"] == 0 and db["saved"]["count"] == 0
