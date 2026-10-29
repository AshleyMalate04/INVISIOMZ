from __future__ import annotations

import io
import time
from typing import Any

import jwt
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.core.config import Settings
from app.main import create_app

JWT_SECRET = "test-secret-with-at-least-32-characters-long!"
PASSWORD = "uma-senha-bem-forte-123"


def make_settings(**overrides: Any) -> Settings:
    base = dict(
        environment="test",
        scrypt_log2n=14,  # mínimo permitido: testes mais rápidos
        rate_limit_enabled=False,
        allow_guest=True,  # os testes antigos usam convidados; o comportamento por defeito é testado à parte
        max_image_pixels=4_000_000,
        supabase_url="",  # os testes não dependem de variáveis SUPABASE_* do ambiente (a integração define as suas)
        supabase_anon_key="",
        supabase_service_role_key="",
        supabase_jwt_secret=JWT_SECRET,
        ip_hash_salt="test-salt",
        _env_file=None,
    )
    base.update(overrides)
    return Settings(**base)


@pytest.fixture
def settings() -> Settings:
    return make_settings()


def random_image(width: int = 200, height: int = 150, mode: str = "RGB", seed: int = 7) -> Image.Image:
    rng = np.random.default_rng(seed)
    channels = {"RGB": 3, "RGBA": 4, "L": 1, "LA": 2}.get(mode)
    if channels:
        arr = rng.integers(0, 256, (height, width, channels), dtype=np.uint8)
        if channels == 1:
            arr = arr[..., 0]
        return Image.fromarray(arr)
    base = Image.fromarray(rng.integers(0, 256, (height, width, 3), dtype=np.uint8))
    if mode == "P":
        return base.convert("P", palette=Image.Palette.ADAPTIVE, colors=64)
    if mode == "CMYK":
        return base.convert("CMYK")
    raise ValueError(mode)


def encode(im: Image.Image, fmt: str, **kw: Any) -> bytes:
    buf = io.BytesIO()
    im.save(buf, format=fmt, **kw)
    return buf.getvalue()


@pytest.fixture
def png_bytes() -> bytes:
    return encode(random_image(), "PNG")


def make_token(user_id: str = "11111111-1111-1111-1111-111111111111", *, exp_in: int = 3600, aud: str = "authenticated",
               secret: str = JWT_SECRET, email: str = "a@example.com") -> str:
    now = int(time.time())
    return jwt.encode(
        {"sub": user_id, "aud": aud, "role": "authenticated", "email": email, "iat": now, "exp": now + exp_in},
        secret, algorithm="HS256",
    )


@pytest.fixture
def client(settings: Settings):
    app = create_app(settings)
    with TestClient(app) as c:
        yield c
