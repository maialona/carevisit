from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps import get_current_user
from app.models.models import RecordStatus, User, VisitRecord
from app.schemas.schemas import (
    ClientCardResponse,
    PaginatedResponse,
    VisitRecordBrief,
)

router = APIRouter(prefix="/clients", tags=["clients"])


def _base_query_for_user(current_user: User):
    """Return a base WHERE clause scoped to the current user's visibility."""
    if current_user.role == "admin":
        org_user_ids = select(User.id).where(User.org_id == current_user.org_id)
        return VisitRecord.user_id.in_(org_user_ids)
    return VisitRecord.user_id == current_user.id


@router.get("", response_model=PaginatedResponse[ClientCardResponse])
async def list_clients(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    visibility = _base_query_for_user(current_user)

    base = (
        select(
            VisitRecord.case_name,
            VisitRecord.org_name,
            func.count().label("record_count"),
            func.max(VisitRecord.visit_date).label("last_visit_date"),
        )
        .where(visibility)
        .where(VisitRecord.status == RecordStatus.completed)
        .group_by(VisitRecord.case_name, VisitRecord.org_name)
    )

    if search:
        base = base.having(VisitRecord.case_name.ilike(f"%{search}%"))

    # Count total groups
    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    rows_q = (
        base.order_by(func.max(VisitRecord.visit_date).desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    result = await db.execute(rows_q)
    rows = result.all()

    items = [
        ClientCardResponse(
            case_name=r.case_name,
            org_name=r.org_name,
            record_count=r.record_count,
            last_visit_date=r.last_visit_date,
        )
        for r in rows
    ]

    return PaginatedResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=PaginatedResponse.compute_total_pages(total, page_size),
    )


@router.get("/records", response_model=PaginatedResponse[VisitRecordBrief])
async def list_client_records(
    case_name: str = Query(...),
    org_name: str = Query(...),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    visibility = _base_query_for_user(current_user)

    base = (
        select(VisitRecord)
        .where(visibility)
        .where(VisitRecord.case_name == case_name)
        .where(VisitRecord.org_name == org_name)
    )

    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    rows_q = (
        base.order_by(VisitRecord.visit_date.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    result = await db.execute(rows_q)
    records = result.scalars().all()

    # Batch fetch user names
    user_ids = list({r.user_id for r in records})
    user_map: dict[str, str] = {}
    if user_ids:
        user_q = await db.execute(
            select(User.id, User.name).where(User.id.in_(user_ids))
        )
        user_map = {str(uid): name for uid, name in user_q.all()}

    items = [
        VisitRecordBrief(
            id=r.id,
            case_name=r.case_name,
            org_name=r.org_name,
            user_id=r.user_id,
            user_name=user_map.get(str(r.user_id), ""),
            visit_type=r.visit_type.value,
            visit_date=r.visit_date,
            raw_input=r.raw_input,
            refined_content=r.refined_content,
            status=r.status.value,
            created_at=r.created_at,
        )
        for r in records
    ]

    return PaginatedResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=PaginatedResponse.compute_total_pages(total, page_size),
    )
