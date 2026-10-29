"""Configuração via variáveis de ambiente, validada no arranque (falha rápida)."""

from __future__ import annotations

import secrets
from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

MIB = 1024 * 1024


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"

    # CORS / documentação -------------------------------------------------------------
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    docs_enabled: bool | None = None  # por defeito: activa fora de produção

    # Acesso: por defeito é preciso iniciar sessão (sem modo convidado)
    allow_guest: bool = False

    # Supabase ----------------------------------------------------------------------
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""  # NUNCA no frontend
    supabase_jwt_secret: str = ""  # HS256; se vazio usa-se JWKS (ES256/RS256)
    storage_bucket: str = "stego-results"
    supabase_timeout_s: float = 8.0

    # Limites de upload ----------------------------------------------------------------
    max_image_bytes: int = 20 * MIB
    max_image_pixels: int = 12_000_000
    max_files: int = Field(default=20, ge=1)
    max_file_bytes: int = 10 * MIB
    max_total_bytes: int = 25 * MIB
    max_message_chars: int = 100_000
    max_request_bytes: int = 60 * MIB

    # Operações pesadas em simultâneo (cada imagem de 12 MP chega a ~1 GB de RAM durante o processamento)
    max_concurrent_jobs: int = Field(default=2, ge=1, le=32)

    # Criptografia -----------------------------------------------------------------
    password_min_length: int = 10
    scrypt_log2n: int = Field(default=15, ge=14, le=20)
    scrypt_r: int = Field(default=8, ge=8, le=16)
    scrypt_p: int = Field(default=1, ge=1, le=4)

    # Rate limiting (pedidos por minuto e por IP) --------------------------------------
    rate_limit_enabled: bool = True
    rate_general_per_min: int = 120
    rate_hide_per_min: int = 20
    rate_extract_per_min: int = 10
    extract_fail_threshold: int = 5
    extract_fail_window_s: int = 900
    extract_lock_base_s: int = 30
    extract_lock_max_s: int = 900
    trust_proxy_headers: bool = False
    proxy_hops: int = Field(default=1, ge=1, le=5)  # nº de proxies de confiança à frente da aplicação

    # Resultados / descargas -----------------------------------------------------------
    extract_inline_max_bytes: int = 4 * MIB
    download_token_ttl_s: int = 300
    download_store_max_bytes: int = 128 * MIB
    signed_url_ttl_s: int = 300
    record_ttl_days: int = Field(default=7, ge=1)
    cleanup_interval_s: int = 3600

    ip_hash_salt: str = ""

    @model_validator(mode="after")
    def _validate(self) -> "Settings":
        salt_missing = not self.ip_hash_salt
        if salt_missing:
            # Em desenvolvimento, um sal aleatório por processo (hashes não correlacionáveis).
            self.ip_hash_salt = secrets.token_hex(16)
        if self.environment == "production":
            problems: list[str] = []
            if "*" in self.origins:
                problems.append("CORS_ORIGINS não pode conter '*' em produção")
            if not (self.supabase_url and self.supabase_anon_key and self.supabase_service_role_key):
                problems.append(
                    "SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY são obrigatórias em produção"
                )
            if salt_missing:
                problems.append("IP_HASH_SALT é obrigatório em produção")
            if problems:
                raise ValueError("; ".join(problems))
        return self

    # Derivados -----------------------------------------------------------------------
    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def docs_on(self) -> bool:
        return self.docs_enabled if self.docs_enabled is not None else not self.is_production

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_anon_key and self.supabase_service_role_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
