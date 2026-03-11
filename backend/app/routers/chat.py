"""AI Chatbot Agent with function calling and SSE streaming."""
from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from openai import AsyncOpenAI

from app.core.config import settings
from app.core.database import get_db
from app.deps import get_current_user
from app.models.models import (
    ChatSession,
    Organization,
    RecordStatus,
    User,
    VisitRecord,
    VisitType,
)

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
                "summary_type": {"type": "string", "enum": ["monthly_summary", "care_suggestion", "risk_assessment"]},
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



async def _exec_get_case_records(args: dict, org_id: uuid.UUID, db: AsyncSession) -> str:
    case_name = args.get("case_name", "")
    visit_type = args.get("visit_type", "all")
    limit = min(args.get("limit", 5), 20)

    if not case_name:
        return "請提供個案姓名。"

    org_user_ids = select(User.id).where(User.org_id == org_id)
    q = select(VisitRecord).where(
        VisitRecord.user_id.in_(org_user_ids),
        VisitRecord.case_name.ilike(f"%{case_name}%")
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

async def _exec_get_statistics(args: dict, org_id: uuid.UUID, db: AsyncSession) -> str:
    period = args.get("period", "this_month")
    group_by = args.get("group_by", "visit_type")
    start, end = _period_range(period)

    org_user_ids = select(User.id).where(User.org_id == org_id)
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


async def _exec_get_pending_records(args: dict, org_id: uuid.UUID, db: AsyncSession) -> str:
    user_id = args.get("user_id", "")
    limit = min(args.get("limit", 10), 20)

    org_user_ids = select(User.id).where(User.org_id == org_id)
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


async def _exec_draft_visit_summary(args: dict, org_id: uuid.UUID, db: AsyncSession) -> str:
    if not case_name:
        return "請提供個案姓名。"

    org_user_ids = select(User.id).where(User.org_id == org_id)
    q = (
        select(VisitRecord)
        .where(
            VisitRecord.user_id.in_(org_user_ids),
            VisitRecord.case_name.ilike(f"%{case_name}%")
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

    return "以下是最近紀錄摘要，請據此生成分析：\n" + "\n\n".join(summary_lines)


FUNCTION_MAP = {
    "get_case_records": _exec_get_case_records,
    "get_statistics": _exec_get_statistics,
    "get_pending_records": _exec_get_pending_records,
    "draft_visit_summary": _exec_draft_visit_summary,
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

    # Use a local variable to collect the full assistant reply
    org_id = current_user.org_id
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
                fn_result = await executor(fn_args, org_id, db)
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

        # Now stream it with the streaming API for a better UX
        current_messages.append({"role": "assistant", "content": final_text})
        # Just send the text in chunks to simulate streaming
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
