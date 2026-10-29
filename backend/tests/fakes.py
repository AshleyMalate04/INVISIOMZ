"""Gateway Supabase em memória, só para testes da API (a integração real está em test_supabase_integration.py).

Emula o essencial do RLS: leituras/remoções «do utilizador» só vêem linhas com `user_id` igual ao `sub` do JWT.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

import jwt

from app.core.errors import AppError


class FakeGateway:
    def __init__(self) -> None:
        self.tables: dict[str, list[dict[str, Any]]] = {"operations": [], "stego_files": [], "audit_log": []}
        self.objects: dict[str, bytes] = {}
        self.deleted_users: list[str] = []
        self.fail_storage = False
        self.service_key_used_for_user_reads = False

    async def aclose(self) -> None:  # pragma: no cover
        return None

    async def health(self) -> bool:
        return True

    @staticmethod
    def _uid(token: str) -> str:
        return jwt.decode(token, options={"verify_signature": False})["sub"]

    @staticmethod
    def _match(row: dict[str, Any], params: dict[str, str]) -> bool:
        for key, cond in params.items():
            if key in {"select", "order", "limit", "offset"}:
                continue
            op, _, value = cond.partition(".")
            current = row.get(key)
            if op == "eq" and str(current) != value:
                return False
            if op == "lt" and not (str(current) < value):
                return False
            if op == "in" and str(current) not in value.strip("()").split(","):
                return False
        return True

    async def service_insert(self, table: str, row: dict[str, Any]) -> None:
        row = dict(row)
        row.setdefault("created_at", datetime.now(timezone.utc).isoformat())
        self.tables[table].append(row)

    async def service_select(self, table: str, params: dict[str, str]) -> list[dict[str, Any]]:
        return [dict(r) for r in self.tables[table] if self._match(r, params)]

    async def service_delete(self, table: str, params: dict[str, str]) -> None:
        self.tables[table] = [r for r in self.tables[table] if not self._match(r, params)]

    async def user_select(self, table: str, token: str, params: dict[str, str], *, count: bool = False):
        uid = self._uid(token)
        rows = [dict(r) for r in self.tables[table] if r.get("user_id") == uid and self._match(r, params)]
        if table == "operations":
            rows.sort(key=lambda r: r["created_at"], reverse=True)
            total = len(rows)
            off, lim = int(params.get("offset", 0)), int(params.get("limit", 100))
            rows = rows[off : off + lim]
            for r in rows:
                r["stego_files"] = [
                    {k: f[k] for k in ("id", "size_bytes", "sha256", "label", "created_at", "expires_at")}
                    for f in self.tables["stego_files"] if f["operation_id"] == r["id"]
                ]
            return rows, (total if count else None)
        return rows, (len(rows) if count else None)

    async def user_delete(self, table: str, token: str, params: dict[str, str]) -> list[dict[str, Any]]:
        uid = self._uid(token)
        gone = [r for r in self.tables[table] if r.get("user_id") == uid and self._match(r, params)]
        self.tables[table] = [r for r in self.tables[table] if r not in gone]
        if table == "operations":  # ON DELETE CASCADE
            ids = {g["id"] for g in gone}
            self.tables["stego_files"] = [f for f in self.tables["stego_files"] if f["operation_id"] not in ids]
        return gone

    async def storage_upload(self, bucket: str, path: str, data: bytes, content_type: str = "image/png") -> None:
        if self.fail_storage:
            raise AppError("STORAGE_ERROR")
        assert content_type == "image/png"
        self.objects[path] = data

    async def storage_sign(self, bucket: str, path: str, ttl_s: int) -> str:
        assert path in self.objects, "só se assinam objectos existentes"
        return f"http://storage.test/object/sign/{bucket}/{path}?token=t{int(time.time())}&ttl={ttl_s}"

    async def storage_delete(self, bucket: str, paths: list[str]) -> None:
        for p in paths:
            self.objects.pop(p, None)

    async def delete_user(self, user_id: str) -> None:
        self.deleted_users.append(user_id)
        for t in self.tables.values():
            t[:] = [r for r in t if r.get("user_id") != user_id]  # ON DELETE CASCADE
