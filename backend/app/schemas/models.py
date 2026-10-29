"""Esquemas de resposta (Pydantic) — documentam a API no OpenAPI."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ModeCapacity(BaseModel):
    raw_capacity_bytes: int
    useful_capacity_bytes: int


class Overhead(BaseModel):
    header_bytes: int
    aead_tag_bytes: int
    fixed_bytes: int
    per_file_bytes: int


class Limits(BaseModel):
    max_image_bytes: int
    max_image_pixels: int
    max_files: int
    max_file_bytes: int
    max_total_bytes: int
    max_message_chars: int
    password_min_length: int


class ConfigOut(BaseModel):
    limits: Limits
    accounts_enabled: bool
    guest_allowed: bool
    record_ttl_days: int
    version: str


class CapacityOut(BaseModel):
    width: int
    height: int
    format: str
    original_size_bytes: int
    warnings: list[str]
    bits: int
    raw_capacity_bytes: int
    useful_capacity_bytes: int
    modes: dict[str, ModeCapacity]
    overhead: Overhead
    limits: Limits


class HealthOut(BaseModel):
    status: str
    version: str
    supabase: str


class ExtractedFileOut(BaseModel):
    id: str
    name: str
    size: int
    sha256: str
    mime: str
    content_b64: str | None = None
    download_token: str | None = None


class ExtractOut(BaseModel):
    message: str | None
    files: list[ExtractedFileOut]
    zip_token: str | None
    inline: bool
    total_bytes: int
    bits: int
    width: int
    height: int
    duration_ms: int
    token_ttl_s: int


class HistoryItem(BaseModel):
    id: str
    type: str
    status: str
    error_code: str | None = None
    bits_per_channel: int | None = None
    image_width: int | None = None
    image_height: int | None = None
    payload_bytes: int = 0
    file_count: int = 0
    has_message: bool = False
    duration_ms: int = 0
    created_at: str
    file: dict[str, Any] | None = None


class HistoryOut(BaseModel):
    items: list[HistoryItem]
    total: int
    limit: int
    offset: int


class DownloadUrlOut(BaseModel):
    url: str
    expires_in: int = Field(description="Segundos de validade do URL assinado")


class DashboardTotals(BaseModel):
    operations: int
    hide: int
    extract: int
    success: int
    failed: int


class DashboardSaved(BaseModel):
    count: int
    bytes: int
    expiring_soon: int = Field(description="Ficheiros que expiram nas próximas 24 h")
    expired: int


class DashboardDay(BaseModel):
    date: str
    hide: int
    extract: int


class DashboardOut(BaseModel):
    totals: DashboardTotals
    saved: DashboardSaved
    last_7_days: list[DashboardDay]
    recent: list[HistoryItem]
    truncated: bool
