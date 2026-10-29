"""Histórico, guardar, eliminar, limpeza e conta — com gateway Supabase simulado em memória."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

from .conftest import PASSWORD, make_settings, make_token, random_image, encode
from .fakes import FakeGateway
from .test_api import extract, hide

USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"


@pytest.fixture
def gw() -> FakeGateway:
    return FakeGateway()


@pytest.fixture
def c(gw):
    s = make_settings(supabase_url="http://supabase.test", supabase_anon_key="anon", supabase_service_role_key="service")
    with TestClient(create_app(s, gateway=gw)) as client:
        yield client


def auth(user: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(user)}"}


@pytest.fixture
def img() -> bytes:
    return encode(random_image(), "PNG")


def test_config_and_health_with_supabase(c):
    assert c.get("/api/config").json()["accounts_enabled"] is True
    assert c.get("/api/health").json()["supabase"] == "ok"


def test_operations_store_only_metadata_never_content(c, gw, img):
    secret = "MENSAGEM-SECRETA-123"
    r = hide(c, img, message=secret, files=[("confidencial.pdf", b"%PDF")], headers=auth(USER_A))
    assert r.status_code == 200
    extract(c, r.content, PASSWORD, headers=auth(USER_A))
    extract(c, r.content, "errada-errada-12", headers=auth(USER_A))
    assert [o["type"] for o in gw.tables["operations"]] == ["hide", "extract", "extract"]
    assert [o["status"] for o in gw.tables["operations"]] == ["success", "success", "failed"]
    assert gw.tables["operations"][2]["error_code"] == "WRONG_PASSWORD_OR_TAMPERED"
    blob = repr(gw.tables)
    for forbidden in (secret, PASSWORD, "confidencial", "errada-errada"):
        assert forbidden not in blob
    allowed = {"id", "user_id", "type", "status", "error_code", "bits_per_channel", "image_width", "image_height",
               "payload_bytes", "file_count", "has_message", "duration_ms", "created_at"}
    assert all(set(o) <= allowed for o in gw.tables["operations"])


def test_guest_operations_store_nothing_but_hashed_ip_audit(c, gw, img):
    r = hide(c, img)
    extract(c, r.content, PASSWORD)
    extract(c, r.content, "errada-errada-12")
    assert gw.tables["operations"] == [] and gw.tables["stego_files"] == [] and gw.objects == {}
    audit = gw.tables["audit_log"]
    assert len(audit) == 1 and audit[0]["event"] == "extract_failed:WRONG_PASSWORD_OR_TAMPERED"
    assert audit[0]["user_id"] is None
    assert "testclient" not in audit[0]["ip_hash"] and "127.0.0.1" not in repr(audit)
    assert len(audit[0]["ip_hash"]) == 32


def test_save_list_download_delete_flow(c, gw, img):
    r = hide(c, img, headers=auth(USER_A), save_to_history="true", label="a minha foto")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/json")
    j = r.json()
    assert j["saved"] is True and j["signed_url"].startswith("http://storage.test/object/sign/stego-results/" + USER_A + "/")
    assert "ttl=300" in j["signed_url"]  # URL assinado de curta duração
    (path,) = gw.objects.keys()
    assert path.startswith(f"{USER_A}/") and path.endswith(".png") and gw.objects[path].startswith(b"\x89PNG")
    row = gw.tables["stego_files"][0]
    expires = datetime.fromisoformat(row["expires_at"])
    assert timedelta(days=6, hours=23) < expires - datetime.now(timezone.utc) <= timedelta(days=7)
    assert row["label"] == "a minha foto" and row["size_bytes"] == len(gw.objects[path])

    hist = c.get("/api/history", headers=auth(USER_A)).json()
    assert hist["total"] == 1 and hist["items"][0]["type"] == "hide"
    assert hist["items"][0]["file"]["expired"] is False

    dl = c.get(f"/api/history/{j['operation_id']}/download", headers=auth(USER_A))
    assert dl.status_code == 200 and dl.json()["expires_in"] == 300 and "token=" in dl.json()["url"]

    assert c.delete(f"/api/history/{j['operation_id']}", headers=auth(USER_A)).status_code == 204
    assert gw.objects == {} and gw.tables["stego_files"] == [] and gw.tables["operations"] == []
    assert c.get("/api/history", headers=auth(USER_A)).json()["total"] == 0


def test_user_cannot_read_or_delete_other_users_data(c, gw, img):
    j = hide(c, img, headers=auth(USER_A), save_to_history="true").json()
    op = j["operation_id"]
    assert c.get("/api/history", headers=auth(USER_B)).json()["items"] == []
    assert c.get(f"/api/history/{op}/download", headers=auth(USER_B)).status_code == 404
    assert c.delete(f"/api/history/{op}", headers=auth(USER_B)).status_code == 404
    assert len(gw.objects) == 1 and len(gw.tables["operations"]) == 1  # nada foi apagado


def test_save_failure_still_returns_png(c, gw, img):
    gw.fail_storage = True
    r = hide(c, img, headers=auth(USER_A), save_to_history="true")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert r.headers["x-saved"] == "false" and r.headers["x-save-error"] == "1"
    assert gw.tables["stego_files"] == []


def test_invalid_operation_id_rejected(c):
    assert c.get("/api/history/nao-e-uuid/download", headers=auth(USER_A)).status_code == 422
    assert c.delete("/api/history/1;drop table operations/", headers=auth(USER_A)).status_code in (404, 405, 422)


def test_history_pagination_validation(c):
    assert c.get("/api/history?limit=0", headers=auth(USER_A)).status_code == 422
    assert c.get("/api/history?limit=101", headers=auth(USER_A)).status_code == 422
    for _ in range(3):
        hide(c, encode(random_image(), "PNG"), headers=auth(USER_A))
    page = c.get("/api/history?limit=2&offset=0", headers=auth(USER_A)).json()
    assert page["total"] == 3 and len(page["items"]) == 2
    assert len(c.get("/api/history?limit=2&offset=2", headers=auth(USER_A)).json()["items"]) == 1


def test_expired_file_not_downloadable_and_cleanup_removes_it(c, gw, img):
    j = hide(c, img, headers=auth(USER_A), save_to_history="true").json()
    gw.tables["stego_files"][0]["expires_at"] = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    item = c.get("/api/history", headers=auth(USER_A)).json()["items"][0]
    assert item["file"]["expired"] is True
    assert c.get(f"/api/history/{j['operation_id']}/download", headers=auth(USER_A)).status_code == 404

    import asyncio

    removed = asyncio.run(c.app.state.history.cleanup_expired())
    assert removed == 1 and gw.objects == {} and gw.tables["stego_files"] == []
    assert len(gw.tables["operations"]) == 1  # o registo da operação (metadados) mantém-se


def test_delete_account_removes_everything(c, gw, img):
    hide(c, img, headers=auth(USER_A), save_to_history="true")
    hide(c, img, headers=auth(USER_B), save_to_history="true")
    assert c.delete("/api/account", headers=auth(USER_A)).status_code == 204
    assert gw.deleted_users == [USER_A]
    assert all(USER_A not in repr(t) for t in gw.tables.values())
    assert [p.split("/")[0] for p in gw.objects] == [USER_B]  # o utilizador B não é afectado


# -- login obrigatório (modo convidado desligado, que é o comportamento por defeito) -----------------
@pytest.fixture
def strict(gw):
    s = make_settings(allow_guest=False, supabase_url="http://supabase.test", supabase_anon_key="anon", supabase_service_role_key="service")
    with TestClient(create_app(s, gateway=gw)) as client:
        yield client


def test_default_setting_has_no_guest_mode():
    from app.core.config import Settings

    assert Settings(_env_file=None).allow_guest is False


def test_without_login_everything_is_401_when_guests_are_off(strict, img):
    assert strict.get("/api/config").json()["guest_allowed"] is False
    assert hide(strict, img).status_code == 401
    assert extract(strict, img).status_code == 401
    assert strict.post("/api/capacity", data={"bits": "1"}, files={"image": ("a.png", img, "image/png")}).status_code == 401
    assert hide(strict, img).json()["error"]["code"] == "UNAUTHORIZED"
    assert strict.get("/api/health").status_code == 200  # saúde e configuração continuam públicas


def test_with_login_everything_works_and_is_recorded(strict, gw, img):
    r = hide(strict, img, headers=auth(USER_A))
    assert r.status_code == 200
    assert extract(strict, r.content, PASSWORD, headers=auth(USER_A)).status_code == 200
    assert strict.post("/api/capacity", data={"bits": "1"}, files={"image": ("a.png", img, "image/png")}, headers=auth(USER_A)).status_code == 200
    assert [o["type"] for o in gw.tables["operations"]] == ["hide", "extract"]


def test_expired_token_is_401_even_if_guests_are_on(c, img):
    from .conftest import make_token

    assert hide(c, img, headers={"Authorization": f"Bearer {make_token(USER_A, exp_in=-5)}"}).status_code == 401


# -- painel --------------------------------------------------------------------------------------------
def test_dashboard_requires_login_and_summarises_only_own_data(strict, gw, img):
    assert strict.get("/api/dashboard").status_code == 401
    r = hide(strict, img, headers=auth(USER_A), save_to_history="true")
    hide(strict, img, headers=auth(USER_A))
    extract(strict, r.content if r.headers["content-type"] == "image/png" else b"x", "errada-errada-1", headers=auth(USER_A))
    hide(strict, img, headers=auth(USER_B))  # outro utilizador: não pode aparecer no painel de A

    d = strict.get("/api/dashboard", headers=auth(USER_A)).json()
    assert d["totals"]["operations"] == 3 and d["totals"]["hide"] == 2 and d["totals"]["extract"] == 1
    assert d["totals"]["success"] == 2 and d["totals"]["failed"] == 1
    assert d["saved"]["count"] == 1 and d["saved"]["bytes"] > 0 and d["saved"]["expiring_soon"] == 0
    assert len(d["last_7_days"]) == 7 and sum(x["hide"] + x["extract"] for x in d["last_7_days"]) == 3
    assert len(d["recent"]) == 3 and d["recent"][0]["type"] == "extract"
    assert d["truncated"] is False

    other = strict.get("/api/dashboard", headers=auth(USER_B)).json()
    assert other["totals"]["operations"] == 1 and other["saved"]["count"] == 0


def test_dashboard_counts_expiring_and_expired_files(strict, gw, img):
    for _ in range(2):
        hide(strict, img, headers=auth(USER_A), save_to_history="true")
    gw.tables["stego_files"][0]["expires_at"] = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
    gw.tables["stego_files"][1]["expires_at"] = (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()
    saved = strict.get("/api/dashboard", headers=auth(USER_A)).json()["saved"]
    assert saved["count"] == 1 and saved["expiring_soon"] == 1 and saved["expired"] == 1


def test_empty_dashboard(strict):
    d = strict.get("/api/dashboard", headers=auth(USER_A)).json()
    assert d["totals"] == {"operations": 0, "hide": 0, "extract": 0, "success": 0, "failed": 0}
    assert d["recent"] == [] and len(d["last_7_days"]) == 7
