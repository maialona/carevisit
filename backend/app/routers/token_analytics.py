from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps import get_current_user
from app.models.models import RefinementLog, VisitRecord, User

router = APIRouter(prefix="/token-analytics", tags=["token-analytics"])


@router.get("")
async def get_token_analytics(
    days: int = Query(30, ge=1, le=30),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org_id = current_user.org_id
    now = datetime.now(tz=timezone.utc)

    if days == 1:
        since = now.replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        since = now - timedelta(days=days - 1)
        since = since.replace(hour=0, minute=0, second=0, microsecond=0)

    # Per-user token usage within selected range
    user_q = (
        select(
            User.id.label("user_id"),
            User.name.label("user_name"),
            func.coalesce(func.sum(RefinementLog.tokens_used), 0).label("total_tokens"),
            func.count(RefinementLog.id).label("call_count"),
        )
        .select_from(User)
        .outerjoin(VisitRecord, VisitRecord.user_id == User.id)
        .outerjoin(
            RefinementLog,
            (RefinementLog.record_id == VisitRecord.id)
            & (RefinementLog.created_at >= since),
        )
        .where(User.org_id == org_id)
        .group_by(User.id, User.name)
        .order_by(func.coalesce(func.sum(RefinementLog.tokens_used), 0).desc())
    )
    user_result = await db.execute(user_q)
    by_user = [
        {
            "user_id": str(row.user_id),
            "user_name": row.user_name,
            "total_tokens": row.total_tokens,
            "call_count": row.call_count,
        }
        for row in user_result.all()
    ]

    # Time-series: hourly for 1-day, daily for 7/30 days
    if days == 1:
        bucket_expr = func.date_trunc("hour", RefinementLog.created_at).label("bucket")
        granularity = "hour"
    else:
        bucket_expr = func.date_trunc("day", RefinementLog.created_at).label("bucket")
        granularity = "day"

    series_q = (
        select(
            bucket_expr,
            func.sum(RefinementLog.tokens_used).label("total_tokens"),
            func.count(RefinementLog.id).label("call_count"),
        )
        .join(VisitRecord, RefinementLog.record_id == VisitRecord.id)
        .join(User, VisitRecord.user_id == User.id)
        .where(User.org_id == org_id)
        .where(RefinementLog.created_at >= since)
        .group_by(text("1"))
        .order_by(text("1"))
    )
    series_result = await db.execute(series_q)

    if granularity == "hour":
        series = [
            {
                "label": row.bucket.strftime("%H:%M"),
                "total_tokens": row.total_tokens,
                "call_count": row.call_count,
            }
            for row in series_result.all()
        ]
    else:
        series = [
            {
                "label": row.bucket.strftime("%Y-%m-%d"),
                "total_tokens": row.total_tokens,
                "call_count": row.call_count,
            }
            for row in series_result.all()
        ]

    total_tokens = sum(u["total_tokens"] for u in by_user)
    total_calls = sum(u["call_count"] for u in by_user)

    return {
        "total_tokens": total_tokens,
        "total_calls": total_calls,
        "by_user": by_user,
        "series": series,
        "granularity": granularity,
    }
