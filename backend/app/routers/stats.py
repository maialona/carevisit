from __future__ import annotations

from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps import get_current_user
from app.models.models import RecordStatus, User, VisitRecord, VisitType
from pydantic import BaseModel

router = APIRouter(prefix="/stats", tags=["stats"])

class DashboardStats(BaseModel):
    home_visits_this_month: int
    phone_visits_this_month: int
    pending_records: int
    total_records: int

@router.get("", response_model=DashboardStats)
async def get_dashboard_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    first_day_of_month = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    
    # Admin sees all org records; supervisor sees only their own
    if current_user.role == "admin":
        base_filter = VisitRecord.user_id.in_(
            select(User.id).where(User.org_id == current_user.org_id)
        )
    else:
        base_filter = VisitRecord.user_id == current_user.id

    # 1. Home visits this month (completed records)
    home_q = select(func.count()).select_from(VisitRecord).where(
        base_filter,
        VisitRecord.visit_type == VisitType.home,
        VisitRecord.visit_date >= first_day_of_month,
        VisitRecord.status == RecordStatus.completed
    )
    home_visits = (await db.execute(home_q)).scalar() or 0

    # 2. Phone visits this month (completed records)
    phone_q = select(func.count()).select_from(VisitRecord).where(
        base_filter,
        VisitRecord.visit_type == VisitType.phone,
        VisitRecord.visit_date >= first_day_of_month,
        VisitRecord.status == RecordStatus.completed
    )
    phone_visits = (await db.execute(phone_q)).scalar() or 0

    # 3. Pending records (drafts)
    draft_q = select(func.count()).select_from(VisitRecord).where(
        base_filter,
        VisitRecord.status == RecordStatus.draft
    )
    pending_records = (await db.execute(draft_q)).scalar() or 0

    # 4. Total records
    records_q = select(func.count()).select_from(VisitRecord).where(
        base_filter
    )
    total_records = (await db.execute(records_q)).scalar() or 0

    return DashboardStats(
        home_visits_this_month=home_visits,
        phone_visits_this_month=phone_visits,
        pending_records=pending_records,
        total_records=total_records
    )
