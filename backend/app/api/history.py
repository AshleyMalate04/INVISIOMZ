from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request, Response

from app.api.deps import require_history, settings_of
from app.core.auth import AuthUser, require_user
from app.core.ratelimit import enforce
from app.schemas.models import DashboardOut, DownloadUrlOut, HistoryOut

router = APIRouter(tags=["histórico"])


@router.get("/dashboard", response_model=DashboardOut)
async def dashboard(request: Request, user: AuthUser = Depends(require_user)) -> dict:
    """Resumo do painel: totais, ficheiros guardados, actividade dos últimos 7 dias e operações recentes."""
    enforce(request, "general", settings_of(request).rate_general_per_min)
    return await require_history(request).dashboard(user)


@router.get("/history", response_model=HistoryOut)
async def list_history(
    request: Request,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: AuthUser = Depends(require_user),
) -> dict:
    enforce(request, "general", settings_of(request).rate_general_per_min)
    return await require_history(request).list_operations(user, limit, offset)


@router.get("/history/{operation_id}/download", response_model=DownloadUrlOut)
async def download_url(operation_id: uuid.UUID, request: Request, user: AuthUser = Depends(require_user)) -> dict:
    enforce(request, "general", settings_of(request).rate_general_per_min)
    return await require_history(request).download_url(user, str(operation_id))


@router.delete("/history/{operation_id}", status_code=204)
async def delete_history(operation_id: uuid.UUID, request: Request, user: AuthUser = Depends(require_user)) -> Response:
    enforce(request, "general", settings_of(request).rate_general_per_min)
    await require_history(request).delete(user, str(operation_id))
    return Response(status_code=204)


@router.delete("/account", status_code=204)
async def delete_account(request: Request, user: AuthUser = Depends(require_user)) -> Response:
    """Elimina a conta e TODOS os dados associados (ficheiros no Storage + registos por CASCADE)."""
    enforce(request, "general", settings_of(request).rate_general_per_min)
    await require_history(request).delete_account(user)
    return Response(status_code=204)
