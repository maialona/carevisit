"""AI Chatbot Agent with function calling and SSE streaming."""
from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from openai import AsyncOpenAI

from app.core.compliance import compute_compliance
from app.core.config import settings
from app.core.database import get_db
from app.deps import get_current_user
from app.models.models import (
    CaseProfile,
    ChatSession,
    MonthlyVisitSchedule,
    Organization,
    RecordStatus,
    User,
    UserRole,
    VisitRecord,
    VisitSchedule,
    VisitType,
    utcnow,
)
from app.routers.schedule import _case_filter, _get_last_visits

router = APIRouter(prefix="/ai", tags=["chat"])

MAX_HISTORY = 20


# ---------- Schemas ----------

class ChatRequest(BaseModel):
    message: str
    session_id: Optional[uuid.UUID] = None


# ---------- Agent functions ----------

AGENT_FUNCTIONS = [
    {
        "name": "get_case_records",
        "description": "取得特定個案的家電訪紀錄列表",
        "parameters": {
            "type": "object",
            "properties": {
                "case_name": {"type": "string", "description": "個案姓名"},
                "visit_type": {"type": "string", "enum": ["home", "phone", "all"]},
                "limit": {"type": "integer", "default": 5},
            },
        },
    },
    {
        "name": "get_statistics",
        "description": "取得統計數據，如本月訪視次數、各督導員工作量",
        "parameters": {
            "type": "object",
            "properties": {
                "period": {"type": "string", "enum": ["today", "this_week", "this_month", "last_month"]},
                "group_by": {"type": "string", "enum": ["visit_type", "user", "status"]},
            },
        },
    },
    {
        "name": "get_pending_records",
        "description": "取得尚未完成（草稿狀態）的紀錄列表",
        "parameters": {
            "type": "object",
            "properties": {
                "user_id": {"type": "string", "description": "指定督導員，空白則查全機構"},
                "limit": {"type": "integer", "default": 10},
            },
        },
    },
    {
        "name": "draft_visit_summary",
        "description": "根據個案最近的紀錄，產生訪視摘要或建議",
        "parameters": {
            "type": "object",
            "properties": {
                "case_name": {"type": "string", "description": "個案姓名"},
                "summary_type": {
                    "type": "string",
                    "enum": ["monthly_summary", "care_suggestion", "risk_assessment"],
                },
            },
        },
    },
    {
        "name": "get_case_profile",
        "description": "查詢個案的基本資料，包含地址、電話、服務狀態",
        "parameters": {
            "type": "object",
            "required": ["case_name"],
            "properties": {
                "case_name": {"type": "string", "description": "個案姓名"},
            },
        },
    },
    {
        "name": "get_visit_schedule",
        "description": "查詢個案的訪視排程（預設訪視日或特定月份的安排）",
        "parameters": {
            "type": "object",
            "required": ["case_name"],
            "properties": {
                "case_name": {"type": "string", "description": "個案姓名"},
                "year": {"type": "integer", "description": "查詢年份，不填則查預設排程"},
                "month": {"type": "integer", "description": "查詢月份（1-12），不填則查預設排程"},
            },
        },
    },
    {
        "name": "get_case_compliance",
        "description": "查詢個案的合規狀態，包含距到期天數和上次訪視日",
        "parameters": {
            "type": "object",
            "required": ["case_name"],
            "properties": {
                "case_name": {"type": "string", "description": "個案姓名"},
            },
        },
    },
    {
        "name": "list_overdue_cases",
        "description": "列出逾期或即將到期的個案清單，用於盤點待辦案次",
        "parameters": {
            "type": "object",
            "properties": {
                "status_filter": {
                    "type": "string",
                    "enum": ["overdue", "due_soon", "all"],
                    "description": "過濾狀態：overdue=逾期、due_soon=即將到期、all=兩者都列出",
                },
            },
        },
    },
    {
        "name": "search_cases",
        "description": "模糊搜尋個案，可用姓名或身分證號查詢",
        "parameters": {
            "type": "object",
            "required": ["query"],
            "properties": {
                "query": {"type": "string", "description": "搜尋關鍵字（姓名或身分證號）"},
                "limit": {"type": "integer", "default": 10},
            },
        },
    },
    {
        "name": "set_visit_schedule",
        "description": "設定或更新個案的訪視日安排。未帶 confirm=true 時只回傳預覽，不實際寫入",
        "parameters": {
            "type": "object",
            "required": ["case_name", "preferred_day"],
            "properties": {
                "case_name": {"type": "string", "description": "個案姓名"},
                "preferred_day": {"type": "integer", "description": "每月訪視日（1-28）"},
                "year": {"type": "integer", "description": "指定年份（用於月份覆寫），不填則設定預設日"},
                "month": {"type": "integer", "description": "指定月份（1-12），不填則設定預設日"},
                "confirm": {
                    "type": "boolean",
                    "description": "設為 true 才實際寫入，否則只回傳預覽",
                },
            },
        },
    },
]


def _period_range(period: str):
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    if period == "today":
        return today_start, now
    elif period == "this_week":
        start = today_start - timedelta(days=today_start.weekday())
        return start, now
    elif period == "this_month":
        start = today_start.replace(day=1)
        return start, now
    elif period == "last_month":
        first_this = today_start.replace(day=1)
        last_end = first_this - timedelta(seconds=1)
        last_start = last_end.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        return last_start, last_end
    return today_start.replace(day=1), now


# ---------- Function executors ----------


async def _exec_get_case_records(args: dict, current_user: User, db: AsyncSession) -> str:
    case_name = args.get("case_name", "")
    visit_type = args.get("visit_type", "all")
    limit = min(args.get("limit", 5), 20)

    if not case_name:
        return "請提供個案姓名。"

    # Bug 2 fix: non-admin can only see their own records
    if current_user.role == UserRole.admin:
        org_user_ids = select(User.id).where(User.org_id == current_user.org_id)
        q = select(VisitRecord).where(
            VisitRecord.user_id.in_(org_user_ids),
            VisitRecord.case_name.ilike(f"%{case_name}%"),
        )
    else:
        q = select(VisitRecord).where(
            VisitRecord.user_id == current_user.id,
            VisitRecord.case_name.ilike(f"%{case_name}%"),
        )

    if visit_type != "all":
        q = q.where(VisitRecord.visit_type == VisitType(visit_type))
    q = q.order_by(VisitRecord.visit_date.desc()).limit(limit)

    result = await db.execute(q)
    records = result.scalars().all()

    if not records:
        return "該個案目前沒有紀錄。"

    lines = []
    for r in records:
        vt = "家訪" if r.visit_type == VisitType.home else "電訪"
        st = "已完成" if r.status == RecordStatus.completed else "草稿"
        d = r.visit_date.strftime("%Y/%m/%d")
        preview = (r.refined_content or r.raw_input or "")[:80]
        lines.append(f"- [{vt}] {d}（{st}）{preview}")
    return f"最近 {len(records)} 筆紀錄：\n" + "\n".join(lines)


async def _exec_get_statistics(args: dict, current_user: User, db: AsyncSession) -> str:
    period = args.get("period", "this_month")
    group_by = args.get("group_by", "visit_type")
    start, end = _period_range(period)

    org_user_ids = select(User.id).where(User.org_id == current_user.org_id)
    base = select(VisitRecord).where(
        VisitRecord.user_id.in_(org_user_ids),
        VisitRecord.visit_date >= start,
        VisitRecord.visit_date <= end,
    )

    period_label = {"today": "今天", "this_week": "本週", "this_month": "本月", "last_month": "上月"}.get(period, period)

    if group_by == "visit_type":
        home_q = select(func.count()).select_from(base.where(VisitRecord.visit_type == VisitType.home).subquery())
        phone_q = select(func.count()).select_from(base.where(VisitRecord.visit_type == VisitType.phone).subquery())
        home_count = (await db.execute(home_q)).scalar() or 0
        phone_count = (await db.execute(phone_q)).scalar() or 0
        total = home_count + phone_count
        return f"{period_label}訪視統計：\n- 家訪：{home_count} 次\n- 電訪：{phone_count} 次\n- 合計：{total} 次"

    elif group_by == "status":
        draft_q = select(func.count()).select_from(base.where(VisitRecord.status == RecordStatus.draft).subquery())
        done_q = select(func.count()).select_from(base.where(VisitRecord.status == RecordStatus.completed).subquery())
        draft = (await db.execute(draft_q)).scalar() or 0
        done = (await db.execute(done_q)).scalar() or 0
        return f"{period_label}紀錄狀態：\n- 已完成：{done} 筆\n- 草稿：{draft} 筆"

    elif group_by == "user":
        q = (
            select(User.name, func.count(VisitRecord.id))
            .join(VisitRecord, VisitRecord.user_id == User.id)
            .where(
                VisitRecord.user_id.in_(org_user_ids),
                VisitRecord.visit_date >= start,
                VisitRecord.visit_date <= end,
            )
            .group_by(User.name)
        )
        result = await db.execute(q)
        rows = result.all()
        if not rows:
            return f"{period_label}沒有訪視紀錄。"
        lines = [f"- {name}：{count} 次" for name, count in rows]
        return f"{period_label}各督導員工作量：\n" + "\n".join(lines)

    return "不支援的分組方式。"


async def _exec_get_pending_records(args: dict, current_user: User, db: AsyncSession) -> str:
    user_id = args.get("user_id", "")
    limit = min(args.get("limit", 10), 20)

    org_user_ids = select(User.id).where(User.org_id == current_user.org_id)
    q = select(VisitRecord).where(
        VisitRecord.user_id.in_(org_user_ids),
        VisitRecord.status == RecordStatus.draft,
    )
    if user_id:
        q = q.where(VisitRecord.user_id == uuid.UUID(user_id))
    q = q.order_by(VisitRecord.visit_date.desc()).limit(limit)

    result = await db.execute(q)
    records = result.scalars().all()

    if not records:
        return "目前沒有待完成的紀錄。"

    lines = []
    for r in records:
        case_name = r.case_name or "?"
        d = r.visit_date.strftime("%Y/%m/%d")
        vt = "家訪" if r.visit_type == VisitType.home else "電訪"
        lines.append(f"- {case_name} [{vt}] {d}")

    return f"共 {len(records)} 筆待完成紀錄：\n" + "\n".join(lines)


async def _exec_draft_visit_summary(args: dict, current_user: User, db: AsyncSession) -> str:
    case_name = args.get("case_name", "")
    # Bug 1 fix: read summary_type and use it
    summary_type = args.get("summary_type", "monthly_summary")

    if not case_name:
        return "請提供個案姓名。"

    # Bug 2 fix: non-admin can only see their own records
    if current_user.role == UserRole.admin:
        org_user_ids = select(User.id).where(User.org_id == current_user.org_id)
        q = (
            select(VisitRecord)
            .where(
                VisitRecord.user_id.in_(org_user_ids),
                VisitRecord.case_name.ilike(f"%{case_name}%"),
            )
            .order_by(VisitRecord.visit_date.desc())
            .limit(5)
        )
    else:
        q = (
            select(VisitRecord)
            .where(
                VisitRecord.user_id == current_user.id,
                VisitRecord.case_name.ilike(f"%{case_name}%"),
            )
            .order_by(VisitRecord.visit_date.desc())
            .limit(5)
        )

    result = await db.execute(q)
    records = result.scalars().all()

    if not records:
        return "該個案沒有紀錄可供摘要。"

    summary_lines = []
    for r in records:
        d = r.visit_date.strftime("%Y/%m/%d")
        vt = "家訪" if r.visit_type == VisitType.home else "電訪"
        content = (r.refined_content or r.raw_input or "")[:200]
        summary_lines.append(f"[{d} {vt}] {content}")

    _type_instructions = {
        "monthly_summary": "請根據以上紀錄，撰寫本月訪視摘要，包含主要觀察與服務執行狀況。",
        "care_suggestion": "請根據以上紀錄，提出具體的照護建議，包含需要特別關注的事項。",
        "risk_assessment": "請根據以上紀錄，進行風險評估，列出潛在風險因子及建議的因應措施。",
    }
    instruction = _type_instructions.get(summary_type, _type_instructions["monthly_summary"])

    return "以下是最近紀錄摘要：\n" + "\n\n".join(summary_lines) + f"\n\n{instruction}"


async def _exec_get_case_profile(args: dict, current_user: User, db: AsyncSession) -> str:
    case_name = args.get("case_name", "")
    if not case_name:
        return "請提供個案姓名。"

    q = select(CaseProfile).where(CaseProfile.name.ilike(f"%{case_name}%"))
    q = _case_filter(q, current_user)
    result = await db.execute(q)
    cases = result.scalars().all()

    if not cases:
        return f"找不到符合「{case_name}」的個案。"

    lines = []
    for c in cases:
        parts = [f"**{c.name}**（{c.id_number}）"]
        if c.service_status:
            parts.append(f"服務狀態：{c.service_status}")
        if c.phone:
            parts.append(f"電話：{c.phone}")
        if c.address:
            parts.append(f"地址：{c.address}")
        if c.supervisor:
            parts.append(f"督導員：{c.supervisor}")
        lines.append("、".join(parts))

    return f"找到 {len(cases)} 筆個案資料：\n" + "\n".join(f"- {l}" for l in lines)


async def _exec_get_visit_schedule(args: dict, current_user: User, db: AsyncSession) -> str:
    case_name = args.get("case_name", "")
    year = args.get("year")
    month = args.get("month")

    if not case_name:
        return "請提供個案姓名。"

    q = select(CaseProfile).where(CaseProfile.name.ilike(f"%{case_name}%"))
    q = _case_filter(q, current_user)
    result = await db.execute(q)
    cases = result.scalars().all()

    if not cases:
        return f"找不到符合「{case_name}」的個案。"

    lines = []
    for c in cases:
        case_lines = [f"**{c.name}**"]

        if year and month:
            # Look for monthly override
            monthly_r = await db.execute(
                select(MonthlyVisitSchedule).where(
                    MonthlyVisitSchedule.case_profile_id == c.id,
                    MonthlyVisitSchedule.year == year,
                    MonthlyVisitSchedule.month == month,
                )
            )
            monthly = monthly_r.scalar_one_or_none()
            if monthly:
                case_lines.append(f"{year}/{month:02d} 訂定訪視日：{monthly.preferred_day} 日")
            else:
                # Fall back to default schedule
                sched_r = await db.execute(
                    select(VisitSchedule).where(VisitSchedule.case_profile_id == c.id)
                )
                sched = sched_r.scalar_one_or_none()
                if sched and sched.preferred_day_of_month:
                    case_lines.append(
                        f"{year}/{month:02d} 無特別安排，使用預設訪視日：{sched.preferred_day_of_month} 日"
                    )
                else:
                    case_lines.append(f"{year}/{month:02d} 尚未安排訪視日。")
        else:
            # Default schedule
            sched_r = await db.execute(
                select(VisitSchedule).where(VisitSchedule.case_profile_id == c.id)
            )
            sched = sched_r.scalar_one_or_none()
            if sched and sched.preferred_day_of_month:
                reminder = "（提醒開啟）" if sched.reminder_enabled else "（提醒關閉）"
                case_lines.append(f"預設訪視日：每月 {sched.preferred_day_of_month} 日{reminder}")
            else:
                case_lines.append("尚未設定預設訪視日。")

        lines.append("、".join(case_lines))

    return "\n".join(f"- {l}" for l in lines)


async def _exec_get_case_compliance(args: dict, current_user: User, db: AsyncSession) -> str:
    case_name = args.get("case_name", "")
    if not case_name:
        return "請提供個案姓名。"

    q = select(CaseProfile).where(CaseProfile.name.ilike(f"%{case_name}%"))
    q = _case_filter(q, current_user)
    result = await db.execute(q)
    cases = result.scalars().all()

    if not cases:
        return f"找不到符合「{case_name}」的個案。"

    case_ids = [c.id for c in cases]
    last_visits = await _get_last_visits(db, case_ids)
    today = date.today()

    lines = []
    for c in cases:
        lv = last_visits.get(c.id, {})
        phone_detail, home_detail, overall = compute_compliance(
            lv.get("phone"), lv.get("home"), today
        )
        status_labels = {
            "ok": "正常",
            "pending": "待訪",
            "due_soon": "即將到期",
            "overdue": "逾期",
            "no_record": "無紀錄",
        }
        overall_label = status_labels.get(overall.value, overall.value)

        parts = [f"**{c.name}** 合規狀態：{overall_label}"]

        if home_detail.last_date:
            days_since = (today - home_detail.last_date).days
            parts.append(f"上次家訪：{home_detail.last_date} （{days_since} 天前）")
        else:
            parts.append("上次家訪：無紀錄")

        if home_detail.due_by:
            days_left = (home_detail.due_by - today).days
            if days_left >= 0:
                parts.append(f"家訪到期日：{home_detail.due_by} （剩 {days_left} 天）")
            else:
                parts.append(f"家訪到期日：{home_detail.due_by} （已逾期 {-days_left} 天）")

        phone_label = status_labels.get(phone_detail.status.value, phone_detail.status.value)
        parts.append(f"電訪本月狀態：{phone_label}")

        lines.append("、".join(parts))

    return "\n".join(f"- {l}" for l in lines)


async def _exec_list_overdue_cases(args: dict, current_user: User, db: AsyncSession) -> str:
    status_filter = args.get("status_filter", "all")

    q = select(CaseProfile)
    q = _case_filter(q, current_user)
    result = await db.execute(q)
    cases = result.scalars().all()

    if not cases:
        return "目前沒有個案資料。"

    case_ids = [c.id for c in cases]
    last_visits = await _get_last_visits(db, case_ids)
    today = date.today()

    target_statuses = {"overdue", "due_soon"} if status_filter == "all" else {status_filter}

    lines = []
    for c in cases:
        lv = last_visits.get(c.id, {})
        _, home_detail, overall = compute_compliance(lv.get("phone"), lv.get("home"), today)
        if overall.value not in target_statuses:
            continue

        status_labels = {"due_soon": "即將到期", "overdue": "逾期"}
        overall_label = status_labels.get(overall.value, overall.value)

        if home_detail.due_by:
            days_left = (home_detail.due_by - today).days
            if days_left >= 0:
                deadline_str = f"到期日 {home_detail.due_by}（剩 {days_left} 天）"
            else:
                deadline_str = f"到期日 {home_detail.due_by}（已逾期 {-days_left} 天）"
        else:
            deadline_str = "無家訪紀錄"

        lines.append(f"- **{c.name}**【{overall_label}】{deadline_str}")

    if not lines:
        label = "逾期或即將到期" if status_filter == "all" else status_filter
        return f"目前沒有{label}的個案。"

    header = "逾期或即將到期" if status_filter == "all" else ("逾期" if status_filter == "overdue" else "即將到期")
    return f"共 {len(lines)} 筆{header}個案：\n" + "\n".join(lines)


async def _exec_search_cases(args: dict, current_user: User, db: AsyncSession) -> str:
    query = args.get("query", "")
    limit = min(args.get("limit", 10), 30)

    if not query:
        return "請提供搜尋關鍵字。"

    q = select(CaseProfile).where(
        or_(
            CaseProfile.name.ilike(f"%{query}%"),
            CaseProfile.id_number.ilike(f"%{query}%"),
        )
    )
    q = _case_filter(q, current_user)
    q = q.limit(limit)
    result = await db.execute(q)
    cases = result.scalars().all()

    if not cases:
        return f"找不到符合「{query}」的個案。"

    lines = []
    for c in cases:
        parts = [f"**{c.name}**（{c.id_number}）"]
        if c.service_status:
            parts.append(c.service_status)
        if c.supervisor:
            parts.append(f"督導：{c.supervisor}")
        lines.append("、".join(parts))

    return f"找到 {len(cases)} 筆個案：\n" + "\n".join(f"- {l}" for l in lines)


async def _exec_set_visit_schedule(args: dict, current_user: User, db: AsyncSession) -> str:
    case_name = args.get("case_name", "")
    preferred_day = args.get("preferred_day")
    year = args.get("year")
    month = args.get("month")
    confirm = args.get("confirm", False)

    if not case_name:
        return "請提供個案姓名。"
    if preferred_day is None or not (1 <= preferred_day <= 28):
        return "preferred_day 必須在 1–28 之間。"

    # Find case with supervisor scope
    q = select(CaseProfile).where(CaseProfile.name.ilike(f"%{case_name}%"))
    q = _case_filter(q, current_user)
    result = await db.execute(q)
    cases = result.scalars().all()

    if not cases:
        return f"找不到符合「{case_name}」的個案。"
    if len(cases) > 1:
        names = "、".join(c.name for c in cases)
        return f"找到多筆個案（{names}），請提供更精確的姓名。"

    c = cases[0]

    if year and month:
        if not (1 <= month <= 12):
            return "month 必須在 1–12 之間。"
        scope = f"{year}/{month:02d}"
        target = f"{c.name} 的 {scope} 訪視日設定為 {preferred_day} 日"
    else:
        scope = "預設"
        target = f"{c.name} 的預設訪視日設定為每月 {preferred_day} 日"

    if not confirm:
        return f"【預覽】{target}。如確認請再次發送並加上 confirm=true。"

    # Actually write
    if year and month:
        monthly_r = await db.execute(
            select(MonthlyVisitSchedule).where(
                MonthlyVisitSchedule.case_profile_id == c.id,
                MonthlyVisitSchedule.year == year,
                MonthlyVisitSchedule.month == month,
            )
        )
        record = monthly_r.scalar_one_or_none()
        if record is None:
            record = MonthlyVisitSchedule(
                case_profile_id=c.id,
                year=year,
                month=month,
                preferred_day=preferred_day,
            )
            db.add(record)
        else:
            record.preferred_day = preferred_day
            record.updated_at = utcnow()
    else:
        sched_r = await db.execute(
            select(VisitSchedule).where(VisitSchedule.case_profile_id == c.id)
        )
        sched = sched_r.scalar_one_or_none()
        if sched is None:
            sched = VisitSchedule(
                case_profile_id=c.id,
                preferred_day_of_month=preferred_day,
                reminder_enabled=True,
            )
            db.add(sched)
        else:
            sched.preferred_day_of_month = preferred_day
            sched.updated_at = utcnow()

    await db.commit()
    return f"已成功更新：{target}。"


FUNCTION_MAP = {
    "get_case_records": _exec_get_case_records,
    "get_statistics": _exec_get_statistics,
    "get_pending_records": _exec_get_pending_records,
    "draft_visit_summary": _exec_draft_visit_summary,
    "get_case_profile": _exec_get_case_profile,
    "get_visit_schedule": _exec_get_visit_schedule,
    "get_case_compliance": _exec_get_case_compliance,
    "list_overdue_cases": _exec_list_overdue_cases,
    "search_cases": _exec_search_cases,
    "set_visit_schedule": _exec_set_visit_schedule,
}


# ---------- Chat endpoint ----------

@router.post("/chat")
async def chat(
    body: ChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Load or create session
    session = None
    if body.session_id:
        sr = await db.execute(
            select(ChatSession).where(
                ChatSession.id == body.session_id,
                ChatSession.user_id == current_user.id,
            )
        )
        session = sr.scalar_one_or_none()

    if session is None:
        session = ChatSession(user_id=current_user.id, messages=[])
        db.add(session)
        await db.flush()

    # Load org name
    org_r = await db.execute(select(Organization.name).where(Organization.id == current_user.org_id))
    org_name = org_r.scalar() or ""

    today_str = date.today().isoformat()
    system_prompt = (
        f"你是「長照小幫手」，一個專為居家長照督導員設計的 AI 助理。\n"
        f"你可以幫助督導員查詢個案資料、家電訪紀錄、統計數據，並協助撰寫文件。\n\n"
        f"目前登入使用者：{current_user.name}（{current_user.role.value}）\n"
        f"所屬機構：{org_name}\n"
        f"今天日期：{today_str}\n\n"
        f"你只能查詢該使用者所屬機構的資料。\n"
        f"回答請使用繁體中文，語氣親切專業。\n"
        f"若使用者詢問系統外的問題，請禮貌說明你的職責範圍。"
    )

    # Build messages
    history: List[dict] = list(session.messages or [])
    history.append({"role": "user", "content": body.message})

    # Trim to max history
    if len(history) > MAX_HISTORY:
        history = history[-MAX_HISTORY:]

    messages = [{"role": "system", "content": system_prompt}] + history

    session_id = session.id

    async def generate():
        nonlocal history
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY, timeout=60.0)

        # First call – may return function call
        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            functions=AGENT_FUNCTIONS,
            function_call="auto",
            stream=False,
        )

        choice = response.choices[0]
        msg = choice.message

        # Handle function calls (up to 3 rounds)
        rounds = 0
        current_messages = list(messages)
        while msg.function_call and rounds < 3:
            fn_name = msg.function_call.name
            try:
                fn_args = json.loads(msg.function_call.arguments)
            except json.JSONDecodeError:
                fn_args = {}

            yield f"data: {json.dumps({'type': 'function_call', 'name': fn_name, 'args': fn_args}, ensure_ascii=False)}\n\n"

            executor = FUNCTION_MAP.get(fn_name)
            if executor:
                fn_result = await executor(fn_args, current_user, db)
            else:
                fn_result = f"未知的函數：{fn_name}"

            yield f"data: {json.dumps({'type': 'function_result', 'content': fn_result[:200]}, ensure_ascii=False)}\n\n"

            current_messages.append({
                "role": "assistant",
                "content": None,
                "function_call": {"name": fn_name, "arguments": msg.function_call.arguments},
            })
            current_messages.append({
                "role": "function",
                "name": fn_name,
                "content": fn_result,
            })

            response = await client.chat.completions.create(
                model="gpt-4o",
                messages=current_messages,
                functions=AGENT_FUNCTIONS,
                function_call="auto",
                stream=False,
            )
            choice = response.choices[0]
            msg = choice.message
            rounds += 1

        # Stream the final text response
        final_text = msg.content or ""

        chunk_size = 20
        for i in range(0, len(final_text), chunk_size):
            chunk = final_text[i : i + chunk_size]
            yield f"data: {json.dumps({'type': 'text', 'content': chunk}, ensure_ascii=False)}\n\n"

        # Save to session
        history.append({"role": "assistant", "content": final_text})
        if len(history) > MAX_HISTORY:
            history = history[-MAX_HISTORY:]

        session.messages = history
        session.updated_at = datetime.now(timezone.utc)
        await db.commit()

        yield f"data: {json.dumps({'type': 'done', 'session_id': str(session_id)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
