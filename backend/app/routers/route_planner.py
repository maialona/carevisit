from __future__ import annotations

import uuid
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.route_agent import DEFAULT_ORIGIN, RouteAgent
from app.deps import get_current_user
from app.models.models import User

router = APIRouter(prefix="/route", tags=["route"])

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


@router.get("/plan")
async def route_plan(
    target_date: date = Query(..., description="規劃日期 (YYYY-MM-DD)"),
    origin: Optional[str] = Query(None, description=f"出發地址，預設 {DEFAULT_ORIGIN}"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Auto mode — Agent queries overdue/due_soon cases and plans route."""
    effective_origin = (origin or "").strip() or DEFAULT_ORIGIN
    agent = RouteAgent(db=db, current_user=current_user)
    return StreamingResponse(
        agent.run(target_date=target_date, origin=effective_origin),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


class ManualPlanRequest(BaseModel):
    case_ids: List[uuid.UUID]
    origin: Optional[str] = None


@router.post("/plan-manual")
async def route_plan_manual(
    body: ManualPlanRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Manual mode — plan route for caller-selected cases."""
    if not body.case_ids:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="請至少選取一位個案")
    if len(body.case_ids) > 23:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="最多可選取 23 位個案（Google Directions API 限制）")

    effective_origin = (body.origin or "").strip() or DEFAULT_ORIGIN
    agent = RouteAgent(db=db, current_user=current_user)
    return StreamingResponse(
        agent.run_manual(case_ids=body.case_ids, origin=effective_origin),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )
