"""Histórico (só metadados), ficheiros guardados, auditoria, limpeza e eliminação de conta."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from app.core.auth import AuthUser
from app.core.config import Settings
from app.core.errors import AppError
from app.services.storage_service import StorageService

log = logging.getLogger("invisiomz.history")

_OP_COLUMNS = (
    "id,type,status,error_code,bits_per_channel,image_width,image_height,payload_bytes,"
    "file_count,has_message,duration_ms,created_at,"
    "stego_files(id,size_bytes,sha256,label,created_at,expires_at)"
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class HistoryService:
    def __init__(self, gateway, storage: StorageService, settings: Settings) -> None:
        self._gw = gateway
        self._storage = storage
        self._s = settings

    # -- escrita (service_role) ---------------------------------------------------------
    async def record_operation(
        self,
        *,
        user_id: str,
        type: str,
        status: str,
        error_code: str | None = None,
        bits: int | None = None,
        width: int | None = None,
        height: int | None = None,
        payload_bytes: int = 0,
        file_count: int = 0,
        has_message: bool = False,
        duration_ms: int = 0,
    ) -> str:
        """Regista SÓ metadados: sem conteúdo, sem senha, sem nomes de ficheiros."""
        op_id = str(uuid.uuid4())
        await self._gw.service_insert(
            "operations",
            {
                "id": op_id,
                "user_id": user_id,
                "type": type,
                "status": status,
                "error_code": error_code,
                "bits_per_channel": bits,
                "image_width": width,
                "image_height": height,
                "payload_bytes": payload_bytes,
                "file_count": file_count,
                "has_message": has_message,
                "duration_ms": duration_ms,
            },
        )
        return op_id

    async def save_result(
        self, *, user_id: str, operation_id: str, png: bytes, sha256: str, label: str | None
    ) -> dict[str, Any]:
        path = await self._storage.upload_png(user_id, png)
        file_id = str(uuid.uuid4())
        expires = _now() + timedelta(days=self._s.record_ttl_days)
        try:
            await self._gw.service_insert(
                "stego_files",
                {
                    "id": file_id,
                    "user_id": user_id,
                    "operation_id": operation_id,
                    "storage_path": path,
                    "size_bytes": len(png),
                    "sha256": sha256,
                    "label": label,
                    "expires_at": expires.isoformat(),
                },
            )
        except AppError:
            await self._storage.delete([path])  # não deixar objectos órfãos
            raise
        return {"id": file_id, "expires_at": expires.isoformat(), "signed_url": await self._storage.signed_url(path)}

    async def audit(self, event: str, user_id: str | None, ip_hash: str | None) -> None:
        """Falhas/eventos de segurança. Nunca regista senha nem IP em claro (só hash com sal)."""
        try:
            await self._gw.service_insert("audit_log", {"user_id": user_id, "event": event, "ip_hash": ip_hash})
        except AppError:
            log.warning("audit failed", extra={"event": "audit_failed"})

    # -- leitura/remoção do utilizador (RLS) -----------------------------------------------
    async def list_operations(self, user: AuthUser, limit: int, offset: int) -> dict[str, Any]:
        rows, total = await self._gw.user_select(
            "operations",
            user.token,
            {"select": _OP_COLUMNS, "order": "created_at.desc", "limit": str(limit), "offset": str(offset)},
            count=True,
        )
        now = _now()
        items = []
        for row in rows:
            files = row.pop("stego_files", None) or []
            f = files[0] if files else None
            if f:
                f["expired"] = datetime.fromisoformat(f["expires_at"].replace("Z", "+00:00")) <= now
            row["file"] = f
            items.append(row)
        return {"items": items, "total": total if total is not None else len(items), "limit": limit, "offset": offset}

    async def _files_of(self, user: AuthUser, operation_id: str) -> list[dict[str, Any]]:
        rows, _ = await self._gw.user_select(
            "stego_files", user.token,
            {"select": "id,storage_path,expires_at", "operation_id": f"eq.{operation_id}"},
        )
        return rows

    async def download_url(self, user: AuthUser, operation_id: str) -> dict[str, Any]:
        files = await self._files_of(user, operation_id)
        if not files:
            raise AppError("NOT_FOUND", "Não existe ficheiro guardado para esta operação.")
        f = files[0]
        if datetime.fromisoformat(f["expires_at"].replace("Z", "+00:00")) <= _now():
            raise AppError("NOT_FOUND", "O ficheiro guardado expirou e já não está disponível.")
        url = await self._storage.signed_url(f["storage_path"])
        return {"url": url, "expires_in": self._s.signed_url_ttl_s}

    async def delete(self, user: AuthUser, operation_id: str) -> None:
        owned, _ = await self._gw.user_select("operations", user.token, {"select": "id", "id": f"eq.{operation_id}"})
        if not owned:
            raise AppError("NOT_FOUND", "Operação não encontrada.")
        files = await self._files_of(user, operation_id)
        await self._storage.delete([f["storage_path"] for f in files])
        await self._gw.user_delete("operations", user.token, {"id": f"eq.{operation_id}"})  # CASCADE -> stego_files

    async def dashboard(self, user: AuthUser) -> dict[str, Any]:
        """Resumo para o painel. Lido com o JWT do utilizador (o RLS garante que só vê o que é seu)."""
        limit = 1000
        ops, _ = await self._gw.user_select(
            "operations", user.token, {"select": _OP_COLUMNS, "order": "created_at.desc", "limit": str(limit)}
        )
        files, _ = await self._gw.user_select(
            "stego_files", user.token, {"select": "id,size_bytes,expires_at", "limit": str(limit)}
        )
        now = _now()
        totals = {"operations": len(ops), "hide": 0, "extract": 0, "success": 0, "failed": 0}
        days = {(now - timedelta(days=i)).date().isoformat(): {"hide": 0, "extract": 0} for i in range(6, -1, -1)}
        for o in ops:
            totals[o["type"]] += 1
            totals[o["status"]] += 1
            day = o["created_at"][:10]
            if day in days:
                days[day][o["type"]] += 1
        live = [f for f in files if datetime.fromisoformat(f["expires_at"].replace("Z", "+00:00")) > now]
        soon = [f for f in live if datetime.fromisoformat(f["expires_at"].replace("Z", "+00:00")) <= now + timedelta(hours=24)]
        recent = []
        for row in ops[:5]:
            fl = row.pop("stego_files", None) or []
            f = fl[0] if fl else None
            if f:
                f["expired"] = datetime.fromisoformat(f["expires_at"].replace("Z", "+00:00")) <= now
            row["file"] = f
            recent.append(row)
        return {
            "totals": totals,
            "saved": {
                "count": len(live),
                "bytes": sum(f["size_bytes"] for f in live),
                "expiring_soon": len(soon),
                "expired": len(files) - len(live),
            },
            "last_7_days": [{"date": d, **v} for d, v in days.items()],
            "recent": recent,
            "truncated": len(ops) >= limit,
        }

    # -- conta e limpeza -----------------------------------------------------------------------
    async def delete_account(self, user: AuthUser) -> None:
        rows = await self._gw.service_select("stego_files", {"select": "storage_path", "user_id": f"eq.{user.id}"})
        await self._storage.delete([r["storage_path"] for r in rows])
        await self._gw.delete_user(user.id)  # ON DELETE CASCADE remove perfil, operações, ficheiros, auditoria

    async def cleanup_expired(self) -> int:
        """Apaga objectos e registos de `stego_files` expirados. Devolve quantos foram removidos."""
        now = _now().isoformat()
        rows = await self._gw.service_select(
            "stego_files", {"select": "id,storage_path", "expires_at": f"lt.{now}", "limit": "500"}
        )
        if not rows:
            return 0
        await self._storage.delete([r["storage_path"] for r in rows])
        ids = ",".join(r["id"] for r in rows)
        await self._gw.service_delete("stego_files", {"id": f"in.({ids})"})
        return len(rows)
