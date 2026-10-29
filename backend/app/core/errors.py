"""Erros da aplicação com códigos estáveis (`error_code`) e mensagens em português."""

from __future__ import annotations

from typing import Any

# Código -> (estado HTTP por defeito, mensagem por defeito)
_CATALOGUE: dict[str, tuple[int, str]] = {
    "WRONG_PASSWORD_OR_TAMPERED": (
        400,
        "Não foi possível abrir o conteúdo. A senha está errada ou a imagem foi alterada. "
        "Com AES-GCM estas duas situações são indistinguíveis por desenho.",
    ),
    "NO_HIDDEN_DATA": (
        400,
        "Esta imagem não contém dados escondidos pelo InvisioMZ.",
    ),
    "CORRUPTED_IMAGE": (
        400,
        "A imagem está corrompida ou o cabeçalho escondido foi danificado.",
    ),
    "TRUNCATED_PAYLOAD": (
        400,
        "Os dados escondidos estão incompletos: a imagem parece ter sido cortada ou truncada.",
    ),
    "UNSUPPORTED_VERSION": (
        400,
        "Esta imagem foi criada com uma versão do formato que esta instalação não suporta.",
    ),
    "ATTACHMENT_RECOVERY_FAILED": (
        400,
        "A autenticação passou, mas não foi possível recuperar os anexos com integridade.",
    ),
    "CAPACITY_EXCEEDED": (
        400,
        "O conteúdo não cabe nesta imagem.",
    ),
    "UNSUPPORTED_IMAGE_FORMAT": (
        415,
        "Formato de imagem não suportado. Use PNG, JPG, WEBP, BMP, GIF, TIFF ou ICO.",
    ),
    "FILE_TOO_LARGE": (413, "O ficheiro ou o pedido excede o limite permitido."),
    "RATE_LIMITED": (429, "Demasiados pedidos. Aguarde um pouco e tente de novo."),
    "UNAUTHORIZED": (401, "Sessão inválida ou expirada. Entre novamente."),
    "FORBIDDEN": (403, "Não tem permissão para esta operação."),
    "NOT_FOUND": (404, "Recurso não encontrado."),
    "VALIDATION_ERROR": (422, "Os dados enviados são inválidos."),
    "WEAK_PASSWORD": (422, "A senha deve ter pelo menos {min} caracteres."),
    "EMPTY_PAYLOAD": (422, "Indique uma mensagem e/ou pelo menos um ficheiro para esconder."),
    "SERVICE_UNAVAILABLE": (503, "Serviço indisponível neste momento."),
    "STORAGE_ERROR": (502, "Falha ao comunicar com o armazenamento."),
    "INTERNAL_ERROR": (500, "Erro interno. Indique o identificador de correlação ao suporte."),
}


class AppError(Exception):
    """Erro de domínio. `code` é estável e pode ser usado pelo frontend."""

    def __init__(
        self,
        code: str,
        message: str | None = None,
        *,
        status: int | None = None,
        details: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        default_status, default_message = _CATALOGUE.get(code, (400, "Erro."))
        self.code = code
        self.status = status if status is not None else default_status
        self.message = message or default_message
        self.details = details or {}
        self.headers = headers or {}
        super().__init__(f"{code}: {self.message}")

    def to_payload(self, correlation_id: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details:
            body["details"] = self.details
        if correlation_id:
            body["correlation_id"] = correlation_id
        return {"error": body}
