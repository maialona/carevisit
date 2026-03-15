from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps import get_current_user, require_admin
from app.models.models import Organization, User
from app.schemas.schemas import OrgSettingsUpdate, OrganizationResponse

router = APIRouter(prefix="/org", tags=["org"])


@router.get("/settings", response_model=OrganizationResponse)
async def get_org_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Organization).where(Organization.id == current_user.org_id))
    return result.scalar_one()


@router.put("/settings", response_model=OrganizationResponse)
async def update_org_settings(
    body: OrgSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(select(Organization).where(Organization.id == current_user.org_id))
    org = result.scalar_one()

    if body.supervisor_can_create_case is not None:
        org.supervisor_can_create_case = body.supervisor_can_create_case
    if body.supervisor_can_delete_case is not None:
        org.supervisor_can_delete_case = body.supervisor_can_delete_case

    await db.flush()
    return org
