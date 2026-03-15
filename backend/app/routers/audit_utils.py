from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import AuditActionType, AuditLog


async def log_action(
    db: AsyncSession,
    actor: Any,
    action: AuditActionType,
    resource_type: str,
    resource_id: str | None = None,
    resource_label: str | None = None,
    detail: dict | None = None,
) -> None:
    db.add(AuditLog(
        org_id=actor.org_id,
        actor_id=actor.id,
        actor_name=actor.name,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        resource_label=resource_label,
        detail=detail,
    ))
    # No flush — commits together with main transaction
