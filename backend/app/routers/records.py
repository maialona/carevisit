from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps import get_current_user, check_record_owner_or_admin
from app.models.models import (
    AuditActionType,
    CaseProfile,
    RecordStatus,
    User,
    VisitRecord,
    VisitType,
    OutputFormat,
)
from app.routers.audit_utils import log_action
from app.schemas.schemas import (
    PaginatedResponse,
    VisitRecordCreate,
    VisitRecordResponse,
    VisitRecordUpdate,
)

router = APIRouter(prefix="/records", tags=["records"])


# ---------- helpers ----------

async def _enrich_record(record: VisitRecord, db: AsyncSession) -> VisitRecordResponse:
    user_q = await db.execute(select(User.name).where(User.id == record.user_id))
    user_name = user_q.scalar() or ""
    return VisitRecordResponse(
        id=record.id,
        case_name=record.case_name,
        org_name=record.org_name,
        user_id=record.user_id,
        user_name=user_name,
        visit_type=record.visit_type.value,
        visit_date=record.visit_date,
        raw_input=record.raw_input,
        refined_content=record.refined_content,
        output_format=record.output_format.value,
        auto_refine=record.auto_refine,
        status=record.status.value,
        created_at=record.created_at,
        updated_at=record.updated_at,
        case_profile_id=record.case_profile_id,
    )


# ---------- endpoints ----------

@router.get("", response_model=PaginatedResponse[VisitRecordResponse])
async def list_records(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    case_name: Optional[str] = Query(None),
    visit_type: Optional[str] = Query(None),
    record_status: Optional[str] = Query(None, alias="status"),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    user_id: Optional[str] = Query(None),
    case_profile_id: Optional[uuid.UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Admin sees all records in org; supervisor sees only their own
    if current_user.role == "admin":
        org_user_ids = select(User.id).where(User.org_id == current_user.org_id)
        base = select(VisitRecord).where(VisitRecord.user_id.in_(org_user_ids))
    else:
        base = select(VisitRecord).where(VisitRecord.user_id == current_user.id)

    if case_name:
        term = f"%{case_name}%"
        base = base.where(VisitRecord.case_name.ilike(term))
    if visit_type:
        base = base.where(VisitRecord.visit_type == VisitType(visit_type))
    if record_status:
        base = base.where(VisitRecord.status == RecordStatus(record_status))
    if date_from:
        base = base.where(VisitRecord.visit_date >= datetime(date_from.year, date_from.month, date_from.day, tzinfo=timezone.utc))
    if date_to:
        base = base.where(VisitRecord.visit_date <= datetime(date_to.year, date_to.month, date_to.day, 23, 59, 59, tzinfo=timezone.utc))
    if user_id:
        base = base.where(VisitRecord.user_id == uuid.UUID(user_id))
    if case_profile_id:
        base = base.where(VisitRecord.case_profile_id == case_profile_id)

    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    rows_q = base.order_by(VisitRecord.visit_date.desc()).offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(rows_q)
    records = result.scalars().all()

    items = [await _enrich_record(r, db) for r in records]

    return PaginatedResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=PaginatedResponse.compute_total_pages(total, page_size),
    )


@router.post("", response_model=VisitRecordResponse, status_code=status.HTTP_201_CREATED)
async def create_record(
    body: VisitRecordCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    case_name = body.case_name
    if body.case_profile_id:
        profile_result = await db.execute(
            select(CaseProfile).where(
                CaseProfile.id == body.case_profile_id,
                CaseProfile.org_id == current_user.org_id,
            )
        )
        profile = profile_result.scalar_one_or_none()
        if profile is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="個案不存在")
        case_name = profile.name

    record = VisitRecord(
        case_name=case_name,
        org_name=body.org_name,
        user_id=current_user.id,
        visit_type=VisitType(body.visit_type),
        visit_date=datetime(body.visit_date.year, body.visit_date.month, body.visit_date.day, tzinfo=timezone.utc),
        raw_input=body.raw_input,
        refined_content=body.refined_content,
        output_format=OutputFormat(body.output_format),
        auto_refine=body.auto_refine,
        status=RecordStatus(body.status),
        case_profile_id=body.case_profile_id,
    )
    db.add(record)
    await db.flush()
    await log_action(db, current_user, AuditActionType.record_create, "visit_record",
                     resource_id=str(record.id), resource_label=record.case_name)
    return await _enrich_record(record, db)


@router.get("/{record_id}", response_model=VisitRecordResponse)
async def get_record(
    record_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(VisitRecord).where(VisitRecord.id == record_id))
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="紀錄不存在")

    # Supervisor can only access own records; admin can access all in org
    if current_user.role == "admin":
        user_result = await db.execute(select(User).where(User.id == record.user_id))
        record_user = user_result.scalar_one_or_none()
        if not record_user or record_user.org_id != current_user.org_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="權限不足")
    else:
        if record.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="權限不足")

    return await _enrich_record(record, db)


@router.put("/{record_id}", response_model=VisitRecordResponse)
async def update_record(
    record_id: uuid.UUID,
    body: VisitRecordUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(VisitRecord).where(VisitRecord.id == record_id))
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="紀錄不存在")

    check_record_owner_or_admin(record, current_user)

    # Supervisor can only update own records; admin can update all in org
    if current_user.role == "admin":
        user_result = await db.execute(select(User).where(User.id == record.user_id))
        record_user = user_result.scalar_one_or_none()
        if not record_user or record_user.org_id != current_user.org_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="權限不足")
    else:
        if record.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="權限不足")

    update_data = body.model_dump(exclude_unset=True)
    if "visit_date" in update_data and update_data["visit_date"] is not None:
        d = update_data["visit_date"]
        update_data["visit_date"] = datetime(d.year, d.month, d.day, tzinfo=timezone.utc)
    if "status" in update_data:
        update_data["status"] = RecordStatus(update_data["status"])
    if "output_format" in update_data:
        update_data["output_format"] = OutputFormat(update_data["output_format"])
    if "visit_type" in update_data:
        update_data["visit_type"] = VisitType(update_data["visit_type"])

    for field, value in update_data.items():
        setattr(record, field, value)

    record.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await log_action(db, current_user, AuditActionType.record_update, "visit_record",
                     resource_id=str(record.id), resource_label=record.case_name)
    return await _enrich_record(record, db)


@router.delete("/{record_id}", status_code=status.HTTP_200_OK)
async def delete_record(
    record_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(VisitRecord).where(VisitRecord.id == record_id))
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="紀錄不存在")

    check_record_owner_or_admin(record, current_user)

    # Supervisor can only delete own records; admin can delete all in org
    if current_user.role == "admin":
        user_result = await db.execute(select(User).where(User.id == record.user_id))
        record_user = user_result.scalar_one_or_none()
        if not record_user or record_user.org_id != current_user.org_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="權限不足")
    else:
        if record.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="權限不足")

    record_label = record.case_name
    record_id_str = str(record.id)
    await db.delete(record)
    await db.flush()
    await log_action(db, current_user, AuditActionType.record_delete, "visit_record",
                     resource_id=record_id_str, resource_label=record_label)
    return {"message": "紀錄已刪除"}
