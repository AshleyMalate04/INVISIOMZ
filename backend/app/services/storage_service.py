"""Storage privado `stego-results`: `{user_id}/{uuid}.png`, descarga só por URL assinada de curta duração."""

from __future__ import annotations

import uuid

from app.core.config import Settings


class StorageService:
    def __init__(self, gateway, settings: Settings) -> None:  # gateway: SupabaseGateway (ou equivalente)
        self._gw = gateway
        self._s = settings

    async def upload_png(self, user_id: str, data: bytes) -> str:
        path = f"{user_id}/{uuid.uuid4()}.png"
        await self._gw.storage_upload(self._s.storage_bucket, path, data, "image/png")
        return path

    async def signed_url(self, path: str) -> str:
        return await self._gw.storage_sign(self._s.storage_bucket, path, self._s.signed_url_ttl_s)

    async def delete(self, paths: list[str]) -> None:
        await self._gw.storage_delete(self._s.storage_bucket, paths)
