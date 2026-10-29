"""Cliente fino (httpx) para PostgREST, Storage e Auth Admin do Supabase.

* Escritas de `operations`/`stego_files`/`audit_log` e Storage: `service_role` (só existe aqui).
* Leituras/remoções do utilizador: com o JWT DELE + chave anon, para o RLS ser aplicado pela base de dados.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import Settings
from app.core.errors import AppError

log = logging.getLogger("invisiomz.supabase")


class SupabaseGateway:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self._s = settings
        self._base = settings.supabase_url.rstrip("/")
        self._client = client or httpx.AsyncClient(timeout=settings.supabase_timeout_s)
        self._own_client = client is None

    async def aclose(self) -> None:
        if self._own_client:
            await self._client.aclose()

    # -- infra --------------------------------------------------------------------
    def _service_headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        key = self._s.supabase_service_role_key
        if key.startswith("sb_secret_"):  # chaves novas do Supabase: não são JWT, só vão em `apikey`
            return {"apikey": key, **(extra or {})}
        return {"apikey": key, "Authorization": f"Bearer {key}", **(extra or {})}

    def _user_headers(self, token: str, extra: dict[str, str] | None = None) -> dict[str, str]:
        return {"apikey": self._s.supabase_anon_key, "Authorization": f"Bearer {token}", **(extra or {})}

    async def _request(self, method: str, url: str, *, error_code: str = "SERVICE_UNAVAILABLE", **kw: Any) -> httpx.Response:
        try:
            resp = await self._client.request(method, url, **kw)
        except httpx.HTTPError as exc:
            log.error("supabase unreachable", extra={"event": "supabase_error", "detail": type(exc).__name__})
            raise AppError(error_code) from None
        if resp.status_code in (401, 403) and "/rest/v1/" in url:
            # JWT recusado pelo PostgREST (expirado/inválido para a base de dados)
            raise AppError("UNAUTHORIZED")
        if resp.status_code >= 400:
            log.error("supabase error", extra={"event": "supabase_error", "status": resp.status_code, "path": url.replace(self._base, "")[:60]})
            raise AppError(error_code)
        return resp

    # -- saúde ----------------------------------------------------------------------
    async def health(self) -> bool:
        try:
            resp = await self._client.get(f"{self._base}/auth/v1/health", headers={"apikey": self._s.supabase_anon_key}, timeout=2.0)
            return resp.status_code < 500
        except httpx.HTTPError:
            return False

    # -- PostgREST ------------------------------------------------------------------
    async def service_insert(self, table: str, row: dict[str, Any]) -> None:
        await self._request(
            "POST", f"{self._base}/rest/v1/{table}",
            headers=self._service_headers({"Content-Type": "application/json", "Prefer": "return=minimal"}),
            json=row,
        )

    async def service_select(self, table: str, params: dict[str, str]) -> list[dict[str, Any]]:
        resp = await self._request("GET", f"{self._base}/rest/v1/{table}", headers=self._service_headers(), params=params)
        return resp.json()

    async def service_delete(self, table: str, params: dict[str, str]) -> None:
        await self._request("DELETE", f"{self._base}/rest/v1/{table}", headers=self._service_headers(), params=params)

    async def user_select(
        self, table: str, token: str, params: dict[str, str], *, count: bool = False
    ) -> tuple[list[dict[str, Any]], int | None]:
        extra = {"Prefer": "count=exact"} if count else None
        resp = await self._request("GET", f"{self._base}/rest/v1/{table}", headers=self._user_headers(token, extra), params=params)
        total = None
        if count:
            rng = resp.headers.get("content-range", "")
            if "/" in rng and rng.split("/")[-1].isdigit():
                total = int(rng.split("/")[-1])
        return resp.json(), total

    async def user_delete(self, table: str, token: str, params: dict[str, str]) -> list[dict[str, Any]]:
        resp = await self._request(
            "DELETE", f"{self._base}/rest/v1/{table}",
            headers=self._user_headers(token, {"Prefer": "return=representation"}), params=params,
        )
        return resp.json()

    # -- Storage ---------------------------------------------------------------------
    async def storage_upload(self, bucket: str, path: str, data: bytes, content_type: str = "image/png") -> None:
        await self._request(
            "POST", f"{self._base}/storage/v1/object/{bucket}/{path}",
            error_code="STORAGE_ERROR",
            headers=self._service_headers({"Content-Type": content_type, "x-upsert": "false"}),
            content=data,
        )

    async def storage_sign(self, bucket: str, path: str, ttl_s: int) -> str:
        resp = await self._request(
            "POST", f"{self._base}/storage/v1/object/sign/{bucket}/{path}",
            error_code="STORAGE_ERROR",
            headers=self._service_headers({"Content-Type": "application/json"}),
            json={"expiresIn": ttl_s},
        )
        signed = resp.json().get("signedURL") or resp.json().get("signedUrl")
        if not signed:
            raise AppError("STORAGE_ERROR")
        return signed if signed.startswith("http") else f"{self._base}/storage/v1{signed}"

    async def storage_delete(self, bucket: str, paths: list[str]) -> None:
        if not paths:
            return
        await self._request(
            "DELETE", f"{self._base}/storage/v1/object/{bucket}",
            error_code="STORAGE_ERROR",
            headers=self._service_headers({"Content-Type": "application/json"}),
            json={"prefixes": paths},
        )

    # -- Auth admin --------------------------------------------------------------------
    async def delete_user(self, user_id: str) -> None:
        await self._request("DELETE", f"{self._base}/auth/v1/admin/users/{user_id}", headers=self._service_headers())
