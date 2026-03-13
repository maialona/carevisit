from __future__ import annotations

import uuid
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.compliance import compute_compliance
from app.core.database import get_db
from app.deps import get_current_user
from app.models.models import CaseProfile, User, UserRole, VisitSchedule, utcnow
from app.schemas.schemas import (
    CaseComplianceItem,
    ComplianceStatus,
    ComplianceSummary,
    PaginatedResponse,
    VisitScheduleResponse,
    VisitScheduleUpsert,
)

router = APIRouter(prefix="/schedule", tags=["schedule"])


def _case_filter(query, current_user: User):
    """Apply org + supervisor scope to a CaseProfile query."""
    query = query.where(CaseProfile.org_id == current_user.org_id)
    if current_user.role != UserRole.admin:
        query = query.where(CaseProfile.supervisor == current_user.name)
    return query


async def _get_last_visits(db: AsyncSession, case_ids: List[uuid.UUID]):
    """
    Return dict: case_profile_id -> {"phone": date|None, "home": date|None}
    Uses DISTINCT ON to get the latest completed record per (case, visit_type).
    """
    if not case_ids:
        return {}

    result = await db.execute(
        text("""
            SELECT DISTINCT ON (case_profile_id, visit_type)
                case_profile_id,
                visit_type,
                visit_date::date AS visit_date
            FROM visit_records
            WHERE case_profile_id = ANY(:ids)
              AND status = 'completed'
            ORDER BY case_profile_id, visit_type, visit_date DESC
        """),
        {"ids": case_ids},
    )
    rows = result.fetchall()

    data: dict[uuid.UUID, dict] = {}
    for row in rows:
        cid = row.case_profile_id
        if cid not in data:
            data[cid] = {"phone": None, "home": None}
        vtype = row.visit_type
        vdate = row.visit_date if isinstance(row.visit_date, date) else row.visit_date
        if vtype == "phone":
            data[cid]["phone"] = vdate
        elif vtype == "home":
            data[cid]["home"] = vdate
    return data


async def _get_schedules(db: AsyncSession, case_ids: List[uuid.UUID]):
    """Return dict: case_profile_id -> VisitSchedule|None"""
    if not case_ids:
        return {}
    result = await db.execute(
        select(VisitSchedule).where(VisitSchedule.case_profile_id.in_(case_ids))
    )
    schedules = result.scalars().all()
    return {s.case_profile_id: s for s in schedules}


def _build_item(case: CaseProfile, last_phone, last_home, schedule) -> CaseComplianceItem:
    today = date.today()
    phone_detail, home_detail, overall = compute_compliance(last_phone, last_home, today)
    return CaseComplianceItem(
        case_profile_id=case.id,
        case_name=case.name,
        id_number=case.id_number,
        supervisor=case.supervisor,
        phone_compliance=phone_detail,
        home_compliance=home_detail,
        overall_status=overall,
        schedule=VisitScheduleResponse.model_validate(schedule) if schedule else None,
    )


@router.get("/compliance/summary", response_model=ComplianceSummary)
async def get_compliance_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """4-bucket summary for Dashboard widget."""
    q = select(CaseProfile)
    q = _case_filter(q, current_user)
    result = await db.execute(q)
    cases = result.scalars().all()

    case_ids = [c.id for c in cases]
    last_visits = await _get_last_visits(db, case_ids)

    counts = {"ok": 0, "due_soon": 0, "overdue": 0}
    today = date.today()
    for case in cases:
        lv = last_visits.get(case.id, {})
        _, _, overall = compute_compliance(lv.get("phone"), lv.get("home"), today)
        counts[overall.value] += 1

    return ComplianceSummary(
        ok=counts["ok"],
        due_soon=counts["due_soon"],
        overdue=counts["overdue"],
        total=len(cases),
    )


@router.get("/compliance", response_model=PaginatedResponse[CaseComplianceItem])
async def get_compliance_list(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    status_filter: Optional[ComplianceStatus] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = select(CaseProfile)
    q = _case_filter(q, current_user)
    if search:
        q = q.where(
            or_(
                CaseProfile.name.ilike(f"%{search}%"),
                CaseProfile.id_number.ilike(f"%{search}%"),
            )
        )

    result = await db.execute(q)
    cases = result.scalars().all()

    case_ids = [c.id for c in cases]
    last_visits = await _get_last_visits(db, case_ids)
    schedules = await _get_schedules(db, case_ids)

    today = date.today()
    items: List[CaseComplianceItem] = []
    for case in cases:
        lv = last_visits.get(case.id, {})
        item = _build_item(case, lv.get("phone"), lv.get("home"), schedules.get(case.id))
        if status_filter is None or item.overall_status == status_filter:
            items.append(item)

    total = len(items)
    start = (page - 1) * page_size
    end = start + page_size
    page_items = items[start:end]

    return PaginatedResponse(
        items=page_items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=PaginatedResponse.compute_total_pages(total, page_size),
    )


@router.get("/{case_profile_id}", response_model=Optional[VisitScheduleResponse])
async def get_schedule(
    case_profile_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Verify case belongs to user's org (and supervisor scope)
    case_q = select(CaseProfile).where(
        CaseProfile.id == case_profile_id,
        CaseProfile.org_id == current_user.org_id,
    )
    if current_user.role != UserRole.admin:
        case_q = case_q.where(CaseProfile.supervisor == current_user.name)
    case_result = await db.execute(case_q)
    case = case_result.scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=404, detail="個案不存在")

    result = await db.execute(
        select(VisitSchedule).where(VisitSchedule.case_profile_id == case_profile_id)
    )
    schedule = result.scalar_one_or_none()
    return schedule


@router.put("/{case_profile_id}", response_model=VisitScheduleResponse)
async def upsert_schedule(
    case_profile_id: uuid.UUID,
    body: VisitScheduleUpsert,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Verify case belongs to user's org (and supervisor scope)
    case_q = select(CaseProfile).where(
        CaseProfile.id == case_profile_id,
        CaseProfile.org_id == current_user.org_id,
    )
    if current_user.role != UserRole.admin:
        case_q = case_q.where(CaseProfile.supervisor == current_user.name)
    case_result = await db.execute(case_q)
    case = case_result.scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=404, detail="個案不存在")

    result = await db.execute(
        select(VisitSchedule).where(VisitSchedule.case_profile_id == case_profile_id)
    )
    schedule = result.scalar_one_or_none()

    if schedule is None:
        schedule = VisitSchedule(
            case_profile_id=case_profile_id,
            preferred_day_of_month=body.preferred_day_of_month,
            reminder_enabled=body.reminder_enabled,
        )
        db.add(schedule)
    else:
        schedule.preferred_day_of_month = body.preferred_day_of_month
        schedule.reminder_enabled = body.reminder_enabled
        schedule.updated_at = utcnow()

    await db.commit()
    await db.refresh(schedule)
    return schedule
