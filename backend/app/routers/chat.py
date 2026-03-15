"""AI Chatbot Agent with function calling and SSE streaming."""
from __future__ import annotations

import json
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, or_, select
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

MAX_HISTORY = 30       # messages kept per session
COMPRESS_THRESHOLD = 30  # compress when history hits this
KEEP_RECENT = 10         # always keep these most-recent messages uncompressed


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
        "description": "取得統計數據，如本月訪視次數、各督導員/地區工作量。可用 district_filter 或 supervisor_filter 縮小範圍",
        "parameters": {
            "type": "object",
            "properties": {
                "period": {
                    "type": "string",
                    "enum": ["today", "this_week", "this_month", "last_month"],
                },
                "group_by": {
                    "type": "string",
                    "enum": ["visit_type", "user", "status", "district"],
                },
                "district_filter": {
                    "type": "string",
                    "description": "只統計特定地區（鄉鎮區）的訪視，例如：中西區",
                },
                "supervisor_filter": {
                    "type": "string",
                    "description": "只統計特定督導員的訪視（姓名模糊匹配）",
                },
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
                    "description": "overdue=逾期、due_soon=即將到期、all=兩者都列出",
                },
            },
        },
    },
    {
        "name": "search_cases",
        "description": "搜尋個案，可用姓名、身分證號、地區、督導員或服務狀態組合查詢",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "搜尋關鍵字（姓名或身分證號），可留空並搭配其他篩選",
                },
                "district": {
                    "type": "string",
                    "description": "依地區（鄉鎮區）精確篩選，例如：中西區",
                },
                "supervisor": {
                    "type": "string",
                    "description": "依督導員姓名篩選（模糊匹配）",
                },
                "service_status": {
                    "type": "string",
                    "description": "依服務狀態篩選，例如：服務中、暫停服務",
                },
                "limit": {"type": "integer", "default": 10},
            },
        },
    },
    {
        "name": "list_cases",
        "description": "列出個案清單並統計數量，支援依地區、督導員、服務狀態篩選，支援分頁",
        "parameters": {
            "type": "object",
            "properties": {
                "district": {
                    "type": "string",
                    "description": "依地區（鄉鎮區）篩選，例如：中西區",
                },
                "supervisor": {
                    "type": "string",
                    "description": "依督導員姓名篩選（模糊匹配）",
                },
                "service_status": {
                    "type": "string",
                    "description": "依服務狀態篩選",
                },
                "page": {"type": "integer", "default": 1},
                "page_size": {"type": "integer", "default": 10},
            },
        },
    },
    {
        "name": "get_case_distribution",
        "description": "統計個案的分佈情況，可依性別、地區、服務狀態、督導員分組計算數量與比例。適用於「男女比例」、「各地區個案數」、「各服務狀態人數」等問題",
        "parameters": {
            "type": "object",
            "required": ["group_by"],
            "properties": {
                "group_by": {
                    "type": "string",
                    "enum": ["gender", "district", "service_status", "supervisor"],
                    "description": "分組欄位：gender=性別、district=地區、service_status=服務狀態、supervisor=督導員",
                },
                "district_filter": {
                    "type": "string",
                    "description": "先依地區篩選再統計（可選）",
                },
                "supervisor_filter": {
                    "type": "string",
                    "description": "先依督導員篩選再統計（可選）",
                },
            },
        },
    },
    {
        "name": "get_org_summary",
        "description": "取得全機構快照：總個案數、逾期數、本月訪視進度、草稿紀錄數、各督導員工作量",
        "parameters": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "get_record_detail",
        "description": "取得特定個案某次訪視紀錄的完整內容，用於深入分析或撰寫建議",
        "parameters": {
            "type": "object",
            "required": ["case_name"],
            "properties": {
                "case_name": {"type": "string", "description": "個案姓名"},
                "visit_date": {
                    "type": "string",
                    "description": "訪視日期 YYYY-MM-DD，不填則取最新一筆",
                },
                "visit_type": {
                    "type": "string",
                    "enum": ["home", "phone"],
                    "description": "訪視類型，不填則不限",
                },
            },
        },
    },
    {
        "name": "create_draft_record",
        "description": "將對話中產生的訪視草稿寫入系統，建立一筆草稿紀錄。未帶 confirm=true 時只回傳預覽",
        "parameters": {
            "type": "object",
            "required": ["case_name", "visit_type", "visit_date", "content"],
            "properties": {
                "case_name": {"type": "string", "description": "個案姓名"},
                "visit_type": {"type": "string", "enum": ["home", "phone"]},
                "visit_date": {"type": "string", "description": "訪視日期，格式 YYYY-MM-DD"},
                "content": {"type": "string", "description": "訪視紀錄內容（AI 生成的草稿文字）"},
                "confirm": {"type": "boolean", "description": "設為 true 才實際寫入，否則只回傳預覽"},
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
                "case_name": {"type": "string"},
                "preferred_day": {"type": "integer", "description": "每月訪視日（1-28）"},
                "year": {"type": "integer"},
                "month": {"type": "integer"},
                "confirm": {"type": "boolean"},
            },
        },
    },
    {
        "name": "update_record_status",
        "description": "將草稿訪視紀錄標記為已完成。未帶 confirm=true 時只回傳預覽",
        "parameters": {
            "type": "object",
            "required": ["case_name"],
            "properties": {
                "case_name": {"type": "string"},
                "visit_date": {"type": "string"},
                "visit_type": {"type": "string", "enum": ["home", "phone"]},
                "confirm": {"type": "boolean"},
            },
        },
    },
    {
        "name": "get_upcoming_visits",
        "description": "查詢未來幾天內需要訪視的個案清單，依排程日計算",
        "parameters": {
            "type": "object",
            "properties": {
                "days_ahead": {"type": "integer", "description": "查詢未來幾天，預設 7"},
                "year": {"type": "integer"},
                "month": {"type": "integer"},
            },
        },
    },
    {
        "name": "update_visit_record",
        "description": "更新訪視紀錄的內容或將草稿標記為完成。第一次呼叫請用 confirm=false 預覽，確認後再用 confirm=true 寫入。",
        "parameters": {
            "type": "object",
            "required": ["case_name", "visit_date", "confirm"],
            "properties": {
                "case_name": {"type": "string", "description": "個案姓名"},
                "visit_date": {"type": "string", "description": "訪視日期 YYYY-MM-DD，用來定位特定紀錄"},
                "visit_type": {"type": "string", "enum": ["home", "phone"], "description": "訪視類型（可選，用來在同日有多筆時篩選）"},
                "refined_content": {"type": "string", "description": "新的訪視紀錄內容（可選）"},
                "mark_completed": {"type": "boolean", "description": "設為 true 將草稿標記為已完成（可選）"},
                "confirm": {"type": "boolean", "description": "false 時只顯示預覽，true 才實際寫入"},
            },
        },
    },
    {
        "name": "update_case_profile",
        "description": "更新個案基本資料，如服務狀態、督導員、電話、地址。第一次呼叫請用 confirm=false 預覽，確認後再用 confirm=true 寫入。",
        "parameters": {
            "type": "object",
            "required": ["case_name", "confirm"],
            "properties": {
                "case_name": {"type": "string", "description": "個案姓名"},
                "supervisor": {"type": "string", "description": "新的督導員姓名（可選）"},
                "service_status": {"type": "string", "description": "新的服務狀態，如「服務中」、「暫停服務」、「已結案」（可選）"},
                "phone": {"type": "string", "description": "新的電話號碼（可選）"},
                "address": {"type": "string", "description": "新的地址（可選）"},
                "district": {"type": "string", "description": "新的地區/區（可選）"},
                "confirm": {"type": "boolean", "description": "false 時只顯示預覽，true 才實際寫入"},
            },
        },
    },
    {
        "name": "get_schedule_suggestions",
        "description": "智慧排程建議：分析所有個案的訪視合規狀態與排程設定，提供未設排程個案、逾期風險個案、以及同地區集中安排的建議。",
        "parameters": {
            "type": "object",
            "properties": {
                "focus": {
                    "type": "string",
                    "enum": ["overview", "no_schedule", "at_risk", "by_district"],
                    "description": "建議類型：overview 全面概覽（預設）、no_schedule 未設排程的個案、at_risk 逾期或即將到期的個案、by_district 依地區分組集中安排",
                },
            },
        },
    },
]


# ---------- Helpers ----------

def _period_range(period: str):
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "today":
        return today_start, now
    elif period == "this_week":
        start = today_start - timedelta(days=today_start.weekday())
        return start, now
    elif period == "this_month":
        return today_start.replace(day=1), now
    elif period == "last_month":
        first_this = today_start.replace(day=1)
        last_end = first_this - timedelta(seconds=1)
        last_start = last_end.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        return last_start, last_end
    return today_start.replace(day=1), now


async def _compress_history(history: List[dict], client: AsyncOpenAI) -> List[dict]:
    """AI-summarize older messages, keep KEEP_RECENT most recent ones."""
    old = history[:-KEEP_RECENT]
    recent = history[-KEEP_RECENT:]

    old_text = "\n".join(
        f"[{m['role']}]: {(m.get('content') or '')[:300]}"
        for m in old
        if m.get("content")
    )
    if not old_text.strip():
        return recent

    try:
        resp = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "請將以下對話記錄摘要成一段簡潔的繁體中文，"
                        "保留所有重要的查詢結果、數字、個案資訊和決定事項。摘要控制在 200 字以內。"
                    ),
                },
                {"role": "user", "content": old_text},
            ],
            max_tokens=350,
            timeout=15.0,
        )
        summary = resp.choices[0].message.content or ""
    except Exception:
        return history[-KEEP_RECENT:]

    return [{"role": "system", "content": f"[先前對話摘要]\n{summary}"}] + recent


# ---------- Function executors ----------

async def _exec_get_case_records(args: dict, current_user: User, db: AsyncSession) -> str:
    case_name = args.get("case_name", "")
    visit_type = args.get("visit_type", "all")
    limit = min(args.get("limit", 5), 20)

    if not case_name:
        return "請提供個案姓名。"

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
    district_filter = args.get("district_filter", "")
    supervisor_filter = args.get("supervisor_filter", "")
    start, end = _period_range(period)

    org_user_ids = select(User.id).where(User.org_id == current_user.org_id)
    base = select(VisitRecord).where(
        VisitRecord.user_id.in_(org_user_ids),
        VisitRecord.visit_date >= start,
        VisitRecord.visit_date <= end,
    )

    period_label = {
        "today": "今天", "this_week": "本週",
        "this_month": "本月", "last_month": "上月",
    }.get(period, period)

    # Apply optional filters
    if district_filter:
        base = base.where(VisitRecord.org_name.ilike(f"%{district_filter}%"))
    if supervisor_filter:
        # Filter by user name
        sup_user_ids = select(User.id).where(
            User.org_id == current_user.org_id,
            User.name.ilike(f"%{supervisor_filter}%"),
        )
        base = base.where(VisitRecord.user_id.in_(sup_user_ids))

    filter_note = ""
    if district_filter:
        filter_note += f"（地區：{district_filter}）"
    if supervisor_filter:
        filter_note += f"（督導員：{supervisor_filter}）"

    if group_by == "visit_type":
        home_q = select(func.count()).select_from(
            base.where(VisitRecord.visit_type == VisitType.home).subquery()
        )
        phone_q = select(func.count()).select_from(
            base.where(VisitRecord.visit_type == VisitType.phone).subquery()
        )
        home_count = (await db.execute(home_q)).scalar() or 0
        phone_count = (await db.execute(phone_q)).scalar() or 0
        total = home_count + phone_count
        return (
            f"{period_label}{filter_note}訪視統計：\n"
            f"- 家訪：{home_count} 次\n"
            f"- 電訪：{phone_count} 次\n"
            f"- 合計：{total} 次"
        )

    elif group_by == "status":
        draft_q = select(func.count()).select_from(
            base.where(VisitRecord.status == RecordStatus.draft).subquery()
        )
        done_q = select(func.count()).select_from(
            base.where(VisitRecord.status == RecordStatus.completed).subquery()
        )
        draft = (await db.execute(draft_q)).scalar() or 0
        done = (await db.execute(done_q)).scalar() or 0
        return f"{period_label}{filter_note}紀錄狀態：\n- 已完成：{done} 筆\n- 草稿：{draft} 筆"

    elif group_by == "user":
        q = (
            select(User.name, func.count(VisitRecord.id))
            .join(VisitRecord, VisitRecord.user_id == User.id)
            .where(
                VisitRecord.user_id.in_(org_user_ids),
                VisitRecord.visit_date >= start,
                VisitRecord.visit_date <= end,
            )
        )
        if district_filter:
            q = q.where(VisitRecord.org_name.ilike(f"%{district_filter}%"))
        if supervisor_filter:
            q = q.where(User.name.ilike(f"%{supervisor_filter}%"))
        q = q.group_by(User.name)
        result = await db.execute(q)
        rows = result.all()
        if not rows:
            return f"{period_label}{filter_note}沒有訪視紀錄。"
        lines = [f"- {name}：{count} 次" for name, count in rows]
        return f"{period_label}{filter_note}各督導員工作量：\n" + "\n".join(lines)

    elif group_by == "district":
        q = (
            select(VisitRecord.org_name, func.count(VisitRecord.id))
            .where(
                VisitRecord.user_id.in_(org_user_ids),
                VisitRecord.visit_date >= start,
                VisitRecord.visit_date <= end,
                VisitRecord.org_name.isnot(None),
                VisitRecord.org_name != "",
            )
            .group_by(VisitRecord.org_name)
            .order_by(func.count(VisitRecord.id).desc())
        )
        result = await db.execute(q)
        rows = result.all()
        if not rows:
            return f"{period_label}沒有可依地區統計的訪視紀錄。"
        lines = [f"- {district}：{count} 次" for district, count in rows]
        return f"{period_label}各地區訪視統計：\n" + "\n".join(lines)

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
    summary_type = args.get("summary_type", "monthly_summary")

    if not case_name:
        return "請提供個案姓名。"

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
        if c.district:
            parts.append(f"地區：{c.district}")
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

    status_labels = {
        "ok": "正常", "pending": "待訪", "due_soon": "即將到期",
        "overdue": "逾期", "no_record": "無紀錄",
    }

    lines = []
    for c in cases:
        lv = last_visits.get(c.id, {})
        phone_detail, home_detail, overall = compute_compliance(
            lv.get("phone"), lv.get("home"), today
        )
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
    district = args.get("district", "")
    supervisor = args.get("supervisor", "")
    service_status = args.get("service_status", "")
    limit = min(args.get("limit", 10), 30)

    if not query and not district and not supervisor and not service_status:
        return "請至少提供一個搜尋條件（關鍵字、地區、督導員或服務狀態）。"

    q = select(CaseProfile)
    q = _case_filter(q, current_user)

    if query:
        q = q.where(
            or_(
                CaseProfile.name.ilike(f"%{query}%"),
                CaseProfile.id_number.ilike(f"%{query}%"),
            )
        )
    if district:
        q = q.where(CaseProfile.district == district)
    if supervisor:
        q = q.where(CaseProfile.supervisor.ilike(f"%{supervisor}%"))
    if service_status:
        q = q.where(CaseProfile.service_status.ilike(f"%{service_status}%"))

    q = q.limit(limit)
    result = await db.execute(q)
    cases = result.scalars().all()

    if not cases:
        terms = []
        if query:
            terms.append(f"關鍵字「{query}」")
        if district:
            terms.append(f"地區「{district}」")
        if supervisor:
            terms.append(f"督導員「{supervisor}」")
        if service_status:
            terms.append(f"服務狀態「{service_status}」")
        return f"找不到符合 {' + '.join(terms)} 的個案。"

    lines = []
    for c in cases:
        parts = [f"**{c.name}**（{c.id_number}）"]
        if c.district:
            parts.append(c.district)
        if c.service_status:
            parts.append(c.service_status)
        if c.supervisor:
            parts.append(f"督導：{c.supervisor}")
        lines.append("、".join(parts))

    return f"找到 {len(cases)} 筆個案：\n" + "\n".join(f"- {l}" for l in lines)


async def _exec_list_cases(args: dict, current_user: User, db: AsyncSession) -> str:
    district = args.get("district", "")
    supervisor = args.get("supervisor", "")
    service_status = args.get("service_status", "")
    page = max(1, args.get("page", 1))
    page_size = min(args.get("page_size", 10), 20)

    q = select(CaseProfile)
    q = _case_filter(q, current_user)

    if district:
        q = q.where(CaseProfile.district == district)
    if supervisor:
        q = q.where(CaseProfile.supervisor.ilike(f"%{supervisor}%"))
    if service_status:
        q = q.where(CaseProfile.service_status.ilike(f"%{service_status}%"))

    # Total count
    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    if total == 0:
        terms = []
        if district:
            terms.append(f"地區「{district}」")
        if supervisor:
            terms.append(f"督導員「{supervisor}」")
        if service_status:
            terms.append(f"服務狀態「{service_status}」")
        desc = "（" + " + ".join(terms) + "）" if terms else ""
        return f"目前沒有{desc}的個案。"

    offset = (page - 1) * page_size
    result = await db.execute(q.order_by(CaseProfile.name).offset(offset).limit(page_size))
    cases = result.scalars().all()

    total_pages = (total + page_size - 1) // page_size

    filter_desc = []
    if district:
        filter_desc.append(f"地區：{district}")
    if supervisor:
        filter_desc.append(f"督導員：{supervisor}")
    if service_status:
        filter_desc.append(f"服務狀態：{service_status}")
    filter_note = "（" + "、".join(filter_desc) + "）" if filter_desc else ""

    lines = []
    for c in cases:
        parts = [f"**{c.name}**（{c.id_number}）"]
        if c.service_status:
            parts.append(c.service_status)
        if c.supervisor:
            parts.append(f"督導：{c.supervisor}")
        lines.append("、".join(parts))

    header = f"共 {total} 個個案{filter_note}，第 {page}/{total_pages} 頁（每頁 {page_size} 筆）："
    return header + "\n" + "\n".join(f"- {l}" for l in lines)


async def _exec_get_case_distribution(args: dict, current_user: User, db: AsyncSession) -> str:
    group_by = args.get("group_by", "gender")
    district_filter = args.get("district_filter", "")
    supervisor_filter = args.get("supervisor_filter", "")

    field_map = {
        "gender": CaseProfile.gender,
        "district": CaseProfile.district,
        "service_status": CaseProfile.service_status,
        "supervisor": CaseProfile.supervisor,
    }
    field_label = {
        "gender": "性別", "district": "地區",
        "service_status": "服務狀態", "supervisor": "督導員",
    }

    col = field_map.get(group_by)
    if col is None:
        return "不支援的分組欄位。"

    q = select(col, func.count(CaseProfile.id)).where(CaseProfile.org_id == current_user.org_id)

    if district_filter:
        q = q.where(CaseProfile.district == district_filter)
    if supervisor_filter:
        q = q.where(CaseProfile.supervisor.ilike(f"%{supervisor_filter}%"))

    q = q.group_by(col).order_by(func.count(CaseProfile.id).desc())
    rows = (await db.execute(q)).all()

    if not rows:
        return "目前沒有可統計的個案資料。"

    total = sum(count for _, count in rows)
    label = field_label.get(group_by, group_by)

    lines = []
    for value, count in rows:
        display = value or "（未填）"
        pct = round(count / total * 100, 1) if total else 0
        lines.append(f"- {display}：{count} 人（{pct}%）")

    filter_note = ""
    if district_filter:
        filter_note += f"（地區：{district_filter}）"
    if supervisor_filter:
        filter_note += f"（督導員：{supervisor_filter}）"

    return f"個案{label}分佈{filter_note}（共 {total} 人）：\n" + "\n".join(lines)


async def _exec_get_org_summary(args: dict, current_user: User, db: AsyncSession) -> str:
    org_user_ids = select(User.id).where(User.org_id == current_user.org_id)
    today = date.today()
    month_start = datetime(today.year, today.month, 1, tzinfo=timezone.utc)

    # Total cases
    total_cases = (
        await db.execute(
            select(func.count()).select_from(CaseProfile).where(CaseProfile.org_id == current_user.org_id)
        )
    ).scalar() or 0

    # Draft records
    draft_count = (
        await db.execute(
            select(func.count()).select_from(VisitRecord).where(
                VisitRecord.user_id.in_(org_user_ids),
                VisitRecord.status == RecordStatus.draft,
            )
        )
    ).scalar() or 0

    # This month visits
    home_count = (
        await db.execute(
            select(func.count()).select_from(VisitRecord).where(
                VisitRecord.user_id.in_(org_user_ids),
                VisitRecord.visit_date >= month_start,
                VisitRecord.visit_type == VisitType.home,
            )
        )
    ).scalar() or 0

    phone_count = (
        await db.execute(
            select(func.count()).select_from(VisitRecord).where(
                VisitRecord.user_id.in_(org_user_ids),
                VisitRecord.visit_date >= month_start,
                VisitRecord.visit_type == VisitType.phone,
            )
        )
    ).scalar() or 0

    # Per-supervisor workload this month
    sup_q = (
        select(User.name, func.count(VisitRecord.id))
        .join(VisitRecord, VisitRecord.user_id == User.id)
        .where(
            User.org_id == current_user.org_id,
            VisitRecord.visit_date >= month_start,
        )
        .group_by(User.name)
        .order_by(func.count(VisitRecord.id).desc())
    )
    sup_rows = (await db.execute(sup_q)).all()

    # Compliance counts (batch)
    cases_r = await db.execute(
        select(CaseProfile).where(CaseProfile.org_id == current_user.org_id)
    )
    all_cases = cases_r.scalars().all()
    case_ids = [c.id for c in all_cases]
    last_visits = await _get_last_visits(db, case_ids)

    overdue_count = 0
    due_soon_count = 0
    for c in all_cases:
        lv = last_visits.get(c.id, {})
        _, _, overall = compute_compliance(lv.get("phone"), lv.get("home"), today)
        if overall.value == "overdue":
            overdue_count += 1
        elif overall.value == "due_soon":
            due_soon_count += 1

    lines = [
        f"**全機構快照（{today.strftime('%Y/%m/%d')}）**",
        f"",
        f"📋 個案總數：{total_cases} 人",
        f"⚠️  逾期個案：{overdue_count} 人",
        f"⏰  即將到期：{due_soon_count} 人",
        f"",
        f"📅 本月訪視（{today.month} 月）：",
        f"   家訪 {home_count} 次、電訪 {phone_count} 次、合計 {home_count + phone_count} 次",
        f"",
        f"📝 草稿紀錄：{draft_count} 筆",
    ]

    if sup_rows:
        lines.append("")
        lines.append("👥 本月各督導員工作量：")
        for name, count in sup_rows:
            lines.append(f"   - {name}：{count} 次")

    return "\n".join(lines)


async def _exec_get_record_detail(args: dict, current_user: User, db: AsyncSession) -> str:
    case_name = args.get("case_name", "")
    visit_date_str = args.get("visit_date", "")
    visit_type_str = args.get("visit_type", "")

    if not case_name:
        return "請提供個案姓名。"

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

    if visit_date_str:
        try:
            vd = datetime.strptime(visit_date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            q = q.where(
                VisitRecord.visit_date >= vd,
                VisitRecord.visit_date < vd + timedelta(days=1),
            )
        except ValueError:
            return f"日期格式錯誤：{visit_date_str}，請使用 YYYY-MM-DD。"

    if visit_type_str in ("home", "phone"):
        q = q.where(VisitRecord.visit_type == VisitType(visit_type_str))

    q = q.order_by(VisitRecord.visit_date.desc()).limit(1)
    result = await db.execute(q)
    record = result.scalar_one_or_none()

    if not record:
        return f"找不到「{case_name}」的訪視紀錄。"

    vt = "家訪" if record.visit_type == VisitType.home else "電訪"
    st = "已完成" if record.status == RecordStatus.completed else "草稿"
    d = record.visit_date.strftime("%Y/%m/%d")
    content = record.refined_content or record.raw_input or "（無內容）"

    return (
        f"**{record.case_name}** {d} {vt}（{st}）\n\n"
        f"{content}"
    )


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
        target = f"{c.name} 的 {year}/{month:02d} 訪視日設定為 {preferred_day} 日"
    else:
        target = f"{c.name} 的預設訪視日設定為每月 {preferred_day} 日"

    if not confirm:
        return f"【預覽】{target}。如確認請再次發送並加上 confirm=true。"

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
                case_profile_id=c.id, year=year, month=month, preferred_day=preferred_day,
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
                case_profile_id=c.id, preferred_day_of_month=preferred_day, reminder_enabled=True,
            )
            db.add(sched)
        else:
            sched.preferred_day_of_month = preferred_day
            sched.updated_at = utcnow()

    await db.commit()
    return f"已成功更新：{target}。"


async def _exec_create_draft_record(args: dict, current_user: User, db: AsyncSession) -> str:
    case_name = args.get("case_name", "")
    visit_type_str = args.get("visit_type", "")
    visit_date_str = args.get("visit_date", "")
    content = args.get("content", "")
    confirm = args.get("confirm", False)

    if not case_name:
        return "請提供個案姓名。"
    if visit_type_str not in ("home", "phone"):
        return "visit_type 必須是 home 或 phone。"
    if not visit_date_str:
        return "請提供訪視日期（格式 YYYY-MM-DD）。"
    if not content:
        return "請提供訪視紀錄內容。"

    try:
        visit_date = datetime.strptime(visit_date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return f"日期格式錯誤：{visit_date_str}，請使用 YYYY-MM-DD。"

    visit_type = VisitType(visit_type_str)
    vt_label = "家訪" if visit_type == VisitType.home else "電訪"

    cp_q = select(CaseProfile).where(CaseProfile.name.ilike(f"%{case_name}%"))
    cp_q = _case_filter(cp_q, current_user)
    cp_result = await db.execute(cp_q)
    cp = cp_result.scalars().first()
    case_profile_id = cp.id if cp else None
    district = (cp.district or "") if cp else ""

    preview = (
        f"【預覽】即將建立草稿紀錄：\n"
        f"- 個案：{case_name}\n"
        f"- 居住區域：{district or '（未設定）'}\n"
        f"- 類型：{vt_label}\n"
        f"- 日期：{visit_date_str}\n"
        f"- 內容（前100字）：{content[:100]}\n\n"
        f"如確認請再次發送並加上 confirm=true。"
    )

    if not confirm:
        return preview

    record = VisitRecord(
        case_name=case_name,
        org_name=district,
        user_id=current_user.id,
        visit_type=visit_type,
        visit_date=visit_date,
        raw_input=content,
        refined_content=content,
        status=RecordStatus.draft,
        case_profile_id=case_profile_id,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return f"已成功建立草稿紀錄（ID: {record.id}）：{case_name} {vt_label} {visit_date_str}。您可以到訪視紀錄頁面查看並完成填寫。"


async def _exec_update_record_status(args: dict, current_user: User, db: AsyncSession) -> str:
    case_name = args.get("case_name", "")
    visit_date_str = args.get("visit_date", "")
    visit_type_str = args.get("visit_type", "")
    confirm = args.get("confirm", False)

    if not case_name:
        return "請提供個案姓名。"

    if current_user.role == UserRole.admin:
        org_user_ids = select(User.id).where(User.org_id == current_user.org_id)
        q = select(VisitRecord).where(
            VisitRecord.user_id.in_(org_user_ids),
            VisitRecord.case_name.ilike(f"%{case_name}%"),
            VisitRecord.status == RecordStatus.draft,
        )
    else:
        q = select(VisitRecord).where(
            VisitRecord.user_id == current_user.id,
            VisitRecord.case_name.ilike(f"%{case_name}%"),
            VisitRecord.status == RecordStatus.draft,
        )

    if visit_date_str:
        try:
            vd = datetime.strptime(visit_date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            q = q.where(
                VisitRecord.visit_date >= vd,
                VisitRecord.visit_date < vd + timedelta(days=1),
            )
        except ValueError:
            return f"日期格式錯誤：{visit_date_str}，請使用 YYYY-MM-DD。"

    if visit_type_str in ("home", "phone"):
        q = q.where(VisitRecord.visit_type == VisitType(visit_type_str))

    q = q.order_by(VisitRecord.visit_date.desc()).limit(5)
    result = await db.execute(q)
    records = result.scalars().all()

    if not records:
        return f"找不到「{case_name}」的草稿紀錄。"
    if len(records) > 1:
        lines = []
        for r in records:
            vt = "家訪" if r.visit_type == VisitType.home else "電訪"
            d = r.visit_date.strftime("%Y/%m/%d")
            lines.append(f"- [{vt}] {d}")
        return "找到多筆草稿：\n" + "\n".join(lines) + "\n請提供訪視日期或類型以縮小範圍。"

    r = records[0]
    vt_label = "家訪" if r.visit_type == VisitType.home else "電訪"
    d = r.visit_date.strftime("%Y/%m/%d")
    preview = f"【預覽】即將將「{r.case_name}」{d} {vt_label}草稿標記為已完成。如確認請再次發送並加上 confirm=true。"

    if not confirm:
        return preview

    r.status = RecordStatus.completed
    r.updated_at = utcnow()
    await db.commit()
    return f"已成功將「{r.case_name}」{d} {vt_label}紀錄標記為已完成。"


async def _exec_get_upcoming_visits(args: dict, current_user: User, db: AsyncSession) -> str:
    today = date.today()
    days_ahead = min(args.get("days_ahead", 7), 90)
    year = args.get("year", today.year)
    month = args.get("month", today.month)

    q = select(CaseProfile)
    q = _case_filter(q, current_user)
    result = await db.execute(q)
    cases = result.scalars().all()

    if not cases:
        return "目前沒有個案資料。"

    case_ids = [c.id for c in cases]
    case_map = {c.id: c for c in cases}

    monthly_r = await db.execute(
        select(MonthlyVisitSchedule).where(
            MonthlyVisitSchedule.case_profile_id.in_(case_ids),
            MonthlyVisitSchedule.year == year,
            MonthlyVisitSchedule.month == month,
        )
    )
    monthly_map: dict[uuid.UUID, int] = {
        m.case_profile_id: m.preferred_day for m in monthly_r.scalars().all()
    }

    default_r = await db.execute(
        select(VisitSchedule).where(VisitSchedule.case_profile_id.in_(case_ids))
    )
    default_map: dict[uuid.UUID, int | None] = {
        s.case_profile_id: s.preferred_day_of_month for s in default_r.scalars().all()
    }

    window_start = today
    window_end = today + timedelta(days=days_ahead)

    upcoming = []
    for cid in case_ids:
        preferred_day = monthly_map.get(cid) or default_map.get(cid)
        if not preferred_day:
            continue
        try:
            visit_date = date(year, month, preferred_day)
        except ValueError:
            continue

        if window_start <= visit_date <= window_end:
            c = case_map[cid]
            source = "月份排程" if cid in monthly_map else "預設排程"
            upcoming.append((visit_date, c.name, source))

    if not upcoming:
        label = f"{year}/{month:02d}" if (year != today.year or month != today.month) else "近期"
        return f"{label}內沒有排定訪視的個案（查詢範圍：{days_ahead} 天）。"

    upcoming.sort(key=lambda x: x[0])
    lines = [f"- {d.strftime('%m/%d')}　{name}（{source}）" for d, name, source in upcoming]
    return f"未來 {days_ahead} 天內排定訪視的個案（共 {len(upcoming)} 筆）：\n" + "\n".join(lines)


async def _exec_update_visit_record(args: dict, current_user: User, db: AsyncSession) -> str:
    case_name = args.get("case_name", "")
    visit_date_str = args.get("visit_date", "")
    visit_type_str = args.get("visit_type")
    refined_content = args.get("refined_content")
    mark_completed = args.get("mark_completed", False)
    confirm = args.get("confirm", False)

    if not case_name or not visit_date_str:
        return "請提供個案姓名和訪視日期。"

    try:
        visit_date = datetime.strptime(visit_date_str, "%Y-%m-%d")
    except ValueError:
        return "日期格式錯誤，請用 YYYY-MM-DD。"

    start = visit_date.replace(tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    q = select(VisitRecord).where(
        VisitRecord.case_name.ilike(f"%{case_name}%"),
        VisitRecord.visit_date >= start,
        VisitRecord.visit_date < end,
    )
    if current_user.role != UserRole.admin:
        q = q.where(VisitRecord.user_id == current_user.id)
    else:
        org_ids = select(User.id).where(User.org_id == current_user.org_id)
        q = q.where(VisitRecord.user_id.in_(org_ids))
    if visit_type_str:
        q = q.where(VisitRecord.visit_type == VisitType(visit_type_str))

    records = (await db.execute(q)).scalars().all()
    if not records:
        return f"找不到 {case_name} 在 {visit_date_str} 的訪視紀錄。"
    if len(records) > 1:
        return f"找到 {len(records)} 筆，請提供 visit_type（home/phone）來指定。"

    record = records[0]

    if not refined_content and not mark_completed:
        return "請提供要更新的內容（refined_content）或設定 mark_completed=true。"

    preview_lines = [f"【預覽】將更新 {record.case_name} {visit_date_str} 訪視紀錄："]
    if refined_content:
        preview_lines.append(f"- 內容：{refined_content[:80]}{'...' if len(refined_content) > 80 else ''}")
    if mark_completed:
        preview_lines.append("- 狀態：草稿 → 已完成")
    preview_lines.append("確認請重新呼叫並設定 confirm=true。")

    if not confirm:
        return "\n".join(preview_lines)

    if refined_content:
        record.raw_input = refined_content
        record.refined_content = refined_content
    if mark_completed:
        record.status = RecordStatus.completed
    record.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return f"已成功更新 {record.case_name} {visit_date_str} 的訪視紀錄。"


async def _exec_update_case_profile(args: dict, current_user: User, db: AsyncSession) -> str:
    case_name = args.get("case_name", "")
    confirm = args.get("confirm", False)

    updatable = ["supervisor", "service_status", "phone", "address", "district"]
    updates = {k: args[k] for k in updatable if k in args and args[k] is not None}

    if not case_name:
        return "請提供個案姓名。"
    if not updates:
        return "請提供至少一個要更新的欄位。"

    q = select(CaseProfile).where(
        CaseProfile.name.ilike(f"%{case_name}%"),
        CaseProfile.org_id == current_user.org_id,
    )
    cases = (await db.execute(q)).scalars().all()
    if not cases:
        return f"找不到名字包含「{case_name}」的個案。"
    if len(cases) > 1:
        names = "、".join(c.name for c in cases[:5])
        return f"找到多筆相符個案：{names}，請提供更精確的姓名。"

    case = cases[0]

    field_labels = {
        "supervisor": "督導員",
        "service_status": "服務狀態",
        "phone": "電話",
        "address": "地址",
        "district": "地區",
    }

    preview_lines = [f"【預覽】將更新個案「{case.name}」："]
    for k, v in updates.items():
        old = getattr(case, k) or "（空）"
        preview_lines.append(f"- {field_labels[k]}：{old} → {v}")
    preview_lines.append("確認請重新呼叫並設定 confirm=true。")

    if not confirm:
        return "\n".join(preview_lines)

    for k, v in updates.items():
        setattr(case, k, v)
    case.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return f"已成功更新個案「{case.name}」的資料。"


async def _exec_get_schedule_suggestions(args: dict, current_user: User, db: AsyncSession) -> str:
    focus = args.get("focus", "overview")

    q = select(CaseProfile)
    q = _case_filter(q, current_user)
    cases = (await db.execute(q)).scalars().all()

    if not cases:
        return "目前沒有個案資料。"

    case_ids = [c.id for c in cases]
    today = date.today()

    last_visits = await _get_last_visits(db, case_ids)

    schedule_r = await db.execute(
        select(VisitSchedule).where(VisitSchedule.case_profile_id.in_(case_ids))
    )
    schedule_map = {s.case_profile_id: s for s in schedule_r.scalars().all()}

    status_label = {
        "ok": "✅ 正常",
        "pending": "⏳ 待訪",
        "due_soon": "🔜 即將到期",
        "overdue": "❌ 逾期",
        "no_record": "📭 無紀錄",
    }

    case_infos = []
    for c in cases:
        lv = last_visits.get(c.id, {})
        _, home_detail, overall = compute_compliance(lv.get("phone"), lv.get("home"), today)
        sched = schedule_map.get(c.id)
        case_infos.append({
            "case": c,
            "home_detail": home_detail,
            "overall": overall,
            "schedule": sched,
            "has_schedule": sched is not None and sched.preferred_day_of_month is not None,
        })

    if focus == "no_schedule":
        no_sched = [ci for ci in case_infos if not ci["has_schedule"]]
        if not no_sched:
            return "所有個案都已設定固定排程日！"

        # Build per-district common-day reference from scheduled cases
        district_days: dict[str, list[int]] = defaultdict(list)
        for ci in case_infos:
            if ci["has_schedule"]:
                d = ci["case"].district or "未設定"
                district_days[d].append(ci["schedule"].preferred_day_of_month)

        lines = [f"共 **{len(no_sched)}** 位個案尚未設定固定排程日：\n"]
        for ci in no_sched[:15]:
            c = ci["case"]
            district = c.district or "未設定地區"
            st = status_label.get(ci["overall"].value, ci["overall"].value)
            days = district_days.get(district)
            suggestion = f"（建議第 {Counter(days).most_common(1)[0][0]} 日，同地區慣用）" if days else ""
            lines.append(f"- **{c.name}**（{district}）{st} {suggestion}")
        if len(no_sched) > 15:
            lines.append(f"  ...還有 {len(no_sched) - 15} 位")
        lines.append("\n可呼叫 `set_visit_schedule` 為各個案設定每月固定訪視日。")
        return "\n".join(lines)

    elif focus == "at_risk":
        at_risk = [ci for ci in case_infos if ci["overall"].value in ("overdue", "due_soon")]
        if not at_risk:
            return "目前沒有逾期或即將到期的個案，排程狀況良好！🎉"

        at_risk.sort(key=lambda x: 0 if x["overall"].value == "overdue" else 1)
        lines = [f"共 **{len(at_risk)}** 位個案需要優先安排：\n"]
        for ci in at_risk:
            c = ci["case"]
            st = status_label.get(ci["overall"].value, ci["overall"].value)
            sched = ci["schedule"]
            sched_info = f"（排程第 {sched.preferred_day_of_month} 日）" if sched and sched.preferred_day_of_month else "（未設排程）"
            home = ci["home_detail"]
            if home and home.due_by:
                days_left = (home.due_by - today).days
                due_info = f"，家訪期限 {home.due_by.strftime('%m/%d')}（剩 {days_left} 天）"
            else:
                due_info = ""
            lines.append(f"- **{c.name}** {st}{sched_info}{due_info}")
        lines.append("\n建議優先安排上述個案家訪，必要時使用 `set_visit_schedule` 調整排程日。")
        return "\n".join(lines)

    elif focus == "by_district":
        district_map: dict[str, list[dict]] = defaultdict(list)
        for ci in case_infos:
            d = ci["case"].district or "未設定地區"
            district_map[d].append(ci)

        lines = ["依地區分組的排程建議：\n"]
        for district, cis in sorted(district_map.items(), key=lambda x: -len(x[1])):
            total = len(cis)
            at_risk_count = sum(1 for ci in cis if ci["overall"].value in ("overdue", "due_soon"))
            no_sched_count = sum(1 for ci in cis if not ci["has_schedule"])
            sched_days = [ci["schedule"].preferred_day_of_month for ci in cis if ci["has_schedule"]]
            day_dist = Counter(sched_days)

            lines.append(f"**{district}**（共 {total} 位）")
            if sched_days:
                day_summary = "、".join(
                    f"第{d}日×{c}人" if c > 1 else f"第{d}日"
                    for d, c in day_dist.most_common(4)
                )
                lines.append(f"  現有排程：{day_summary}")
                best_day, best_count = day_dist.most_common(1)[0]
                if best_count > 1:
                    lines.append(f"  💡 第 {best_day} 日已有 {best_count} 位，可集中安排節省交通")
            if no_sched_count:
                lines.append(f"  ⚠ {no_sched_count} 位未設排程")
            if at_risk_count:
                lines.append(f"  🔴 {at_risk_count} 位需優先安排")
        return "\n".join(lines)

    else:  # overview
        no_sched_count = sum(1 for ci in case_infos if not ci["has_schedule"])
        overdue_count = sum(1 for ci in case_infos if ci["overall"].value == "overdue")
        due_soon_count = sum(1 for ci in case_infos if ci["overall"].value == "due_soon")
        ok_count = sum(1 for ci in case_infos if ci["overall"].value == "ok")
        total = len(case_infos)

        lines = ["**智慧排程建議概覽**\n"]
        lines.append(f"機構共 **{total}** 位個案")
        lines.append(f"- ✅ 正常：{ok_count} 位")
        lines.append(f"- 🔜 即將到期：{due_soon_count} 位")
        lines.append(f"- ❌ 逾期：{overdue_count} 位")
        lines.append(f"- 📅 未設排程：{no_sched_count} 位\n")

        if overdue_count > 0:
            lines.append(f"🔴 **優先處理**：{overdue_count} 位逾期個案——請查詢「at_risk」取得詳細行動建議")
        if due_soon_count > 0:
            lines.append(f"🔜 **即將到期**：{due_soon_count} 位，建議本月內完成訪視")
        if no_sched_count > 0:
            lines.append(f"📋 **待設排程**：{no_sched_count} 位個案尚無固定排程日——請查詢「no_schedule」取得建議日期")
        if overdue_count == 0 and due_soon_count == 0 and no_sched_count == 0:
            lines.append("🎉 排程狀況良好！所有個案均已設排程且訪視正常。")
        return "\n".join(lines)


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
    "list_cases": _exec_list_cases,
    "get_case_distribution": _exec_get_case_distribution,
    "get_org_summary": _exec_get_org_summary,
    "get_record_detail": _exec_get_record_detail,
    "create_draft_record": _exec_create_draft_record,
    "set_visit_schedule": _exec_set_visit_schedule,
    "update_record_status": _exec_update_record_status,
    "get_upcoming_visits": _exec_get_upcoming_visits,
    "update_visit_record": _exec_update_visit_record,
    "update_case_profile": _exec_update_case_profile,
    "get_schedule_suggestions": _exec_get_schedule_suggestions,
}


# ---------- Context endpoint (for dynamic quick prompts) ----------

@router.get("/context")
async def get_ai_context(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return lightweight context for the frontend to build dynamic quick prompts."""
    org_user_ids = select(User.id).where(User.org_id == current_user.org_id)
    today = date.today()

    # Draft records (scoped by role)
    if current_user.role == UserRole.admin:
        draft_q = select(func.count()).select_from(VisitRecord).where(
            VisitRecord.user_id.in_(org_user_ids),
            VisitRecord.status == RecordStatus.draft,
        )
    else:
        draft_q = select(func.count()).select_from(VisitRecord).where(
            VisitRecord.user_id == current_user.id,
            VisitRecord.status == RecordStatus.draft,
        )
    draft_count = (await db.execute(draft_q)).scalar() or 0

    # Compliance counts (batch, org-scoped)
    cases_r = await db.execute(
        select(CaseProfile).where(CaseProfile.org_id == current_user.org_id)
    )
    all_cases = cases_r.scalars().all()
    case_ids = [c.id for c in all_cases]
    last_visits = await _get_last_visits(db, case_ids)

    overdue_count = 0
    due_soon_count = 0
    for c in all_cases:
        lv = last_visits.get(c.id, {})
        _, _, overall = compute_compliance(lv.get("phone"), lv.get("home"), today)
        if overall.value == "overdue":
            overdue_count += 1
        elif overall.value == "due_soon":
            due_soon_count += 1

    return {
        "draft_count": draft_count,
        "overdue_count": overdue_count,
        "due_soon_count": due_soon_count,
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

    # Query dynamic context for richer system prompt
    org_user_ids = select(User.id).where(User.org_id == current_user.org_id)
    total_cases = (
        await db.execute(
            select(func.count()).select_from(CaseProfile).where(CaseProfile.org_id == current_user.org_id)
        )
    ).scalar() or 0

    if current_user.role == UserRole.admin:
        draft_count = (
            await db.execute(
                select(func.count()).select_from(VisitRecord).where(
                    VisitRecord.user_id.in_(org_user_ids),
                    VisitRecord.status == RecordStatus.draft,
                )
            )
        ).scalar() or 0
    else:
        draft_count = (
            await db.execute(
                select(func.count()).select_from(VisitRecord).where(
                    VisitRecord.user_id == current_user.id,
                    VisitRecord.status == RecordStatus.draft,
                )
            )
        ).scalar() or 0

    today_str = date.today().isoformat()
    system_prompt = (
        f"你是「長照小幫手」，一個專為居家長照督導員設計的 AI 助理。\n"
        f"你可以幫助督導員查詢個案資料、家電訪紀錄、統計數據、協助撰寫文件、透過對話建立訪視紀錄，以及提供智慧排程建議。\n\n"
        f"目前登入使用者：{current_user.name}（{current_user.role.value}）\n"
        f"所屬機構：{org_name}\n"
        f"今天日期：{today_str}\n"
        f"機構共有 {total_cases} 個個案。\n"
        f"{'你' if current_user.role != UserRole.admin else '機構'}目前有 {draft_count} 筆草稿紀錄待完成。\n\n"
        f"你只能查詢該使用者所屬機構的資料。\n"
        f"回答請使用繁體中文，語氣親切專業。\n"
        f"若使用者詢問系統外的問題，請禮貌說明你的職責範圍。\n\n"
        f"【對話建立訪視紀錄流程】\n"
        f"當使用者說要建立、新增、記錄訪視紀錄時，請依序引導：\n"
        f"1. 詢問個案姓名（若未提供）\n"
        f"2. 詢問訪視類型：家訪（home）或電訪（phone）\n"
        f"3. 詢問訪視日期（若未提供，可建議今天 {today_str}）\n"
        f"4. 請使用者描述訪視內容（若使用者已提供簡短描述，可協助潤飾成完整紀錄）\n"
        f"5. 收集完整後呼叫 create_draft_record（confirm=false）顯示預覽\n"
        f"6. 使用者確認後再呼叫 create_draft_record（confirm=true）寫入系統\n"
        f"每次只詢問一個尚未提供的欄位，不要一次列出所有問題。"
    )

    # Load history and compress if needed
    history: list[dict] = list(session.messages or [])

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY, timeout=60.0)

    if len(history) >= COMPRESS_THRESHOLD:
        history = await _compress_history(history, client)
        session.messages = history
        await db.flush()

    history.append({"role": "user", "content": body.message})

    if len(history) > MAX_HISTORY:
        history = history[-MAX_HISTORY:]

    messages = [{"role": "system", "content": system_prompt}] + history
    session_id = session.id

    async def generate():
        nonlocal history

        # First call — may return function call
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

            # Send full result to frontend (no truncation)
            yield f"data: {json.dumps({'type': 'function_result', 'content': fn_result}, ensure_ascii=False)}\n\n"

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
            chunk = final_text[i: i + chunk_size]
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
