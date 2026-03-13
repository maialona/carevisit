from __future__ import annotations

import base64
import json
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from openai import AsyncOpenAI
import openai

from app.core.config import settings
from app.core.database import get_db
from app.deps import get_current_user
from app.models.models import RefinementLog, User
from app.schemas.schemas import (
    CheckGapsRequest,
    CheckGapsResponse,
    OcrResponse,
    RefineRequest,
    RefineResponse,
    RefineSectionRequest,
    RefineSectionResponse,
    TranscribeResponse,
)

router = APIRouter(prefix="/ai", tags=["ai"])

AUDIO_TYPES = {"audio/webm", "audio/mp4", "audio/m4a", "audio/wav", "audio/mpeg", "video/webm"}
IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}

BULLET_SYSTEM = (
    "你是長照督導員的文書助理，請將以下家電訪粗稿整理為"
    "專業的條列式紀錄，使用繁體中文。"
    "請直接輸出 HTML 格式，架構如下（請嚴格遵守，包括每個子項目之間的 <br> 空行）：\n\n"
    "<h4>一、訪視概述</h4>\n"
    "<br>\n"
    "<h5>1. 【個案生心理狀況】</h5>\n<ul><li>…</li></ul>\n"
    "<br>\n"
    "<h5>2. 【居家環境】</h5>\n<ul><li>…</li></ul>\n"
    "<br>\n"
    "<h5>3. 【主要照顧者照顧項】</h5>\n<ul><li>…</li></ul>\n"
    "<br>\n"
    "<h5>4. 【主要照顧者身心狀況】</h5>\n<ul><li>…</li></ul>\n"
    "<br>\n"
    "<h5>5. 【社交狀況】</h5>\n<ul><li>…</li></ul>\n"
    "<br>\n"
    "<h5>6. 【個案服務需求】</h5>\n<ul><li>…</li></ul>\n"
    "<br>\n"
    "<h5>7. 【居服員服務品質】</h5>\n<ul><li>…</li></ul>\n"
    "<br>\n"
    "<h4>二、主要問題歸納</h4>\n<ul><li>…</li></ul>\n"
    "<br>\n"
    "<h4>三、處遇</h4>\n<ul><li>…</li></ul>\n"
    "<br>\n"
    "<h4>四、追蹤事項</h4>\n<ul><li>…</li></ul>\n\n"
    "重要：每個 <h5> 子項目之間、每個 <h4> 大標題之間都必須加上 <br> 空行，這是強制要求。"
    "若粗稿中某些項目無相關資訊，可簡要標註「無特殊狀況」。"
    "不要使用「・」符號，不要輸出 markdown，語氣專業簡潔。"
)

NARRATIVE_SYSTEM = (
    "你是長照督導員的文書助理，請將以下家電訪粗稿整理為"
    "專業的敘述式紀錄，使用繁體中文，以流暢的段落書寫，"
    "語氣正式專業。"
    "請直接輸出 HTML 格式，架構如下（請嚴格遵守，包括每個子項目之間的 <br> 空行）：\n\n"
    "<h4>一、訪視概述</h4>\n"
    "<br>\n"
    "<h5>1. 【個案生心理狀況】</h5>\n<p>…</p>\n"
    "<br>\n"
    "<h5>2. 【居家環境】</h5>\n<p>…</p>\n"
    "<br>\n"
    "<h5>3. 【主要照顧者照顧項】</h5>\n<p>…</p>\n"
    "<br>\n"
    "<h5>4. 【主要照顧者身心狀況】</h5>\n<p>…</p>\n"
    "<br>\n"
    "<h5>5. 【社交狀況】</h5>\n<p>…</p>\n"
    "<br>\n"
    "<h5>6. 【個案服務需求】</h5>\n<p>…</p>\n"
    "<br>\n"
    "<h5>7. 【居服員服務品質】</h5>\n<p>…</p>\n"
    "<br>\n"
    "<h4>二、主要問題歸納</h4>\n<p>…</p>\n"
    "<br>\n"
    "<h4>三、處遇</h4>\n<p>…</p>\n"
    "<br>\n"
    "<h4>四、追蹤事項</h4>\n<p>…</p>\n\n"
    "重要：每個 <h5> 子項目之間、每個 <h4> 大標題之間都必須加上 <br> 空行，這是強制要求。"
    "若粗稿中某些項目無相關資訊，可簡要標註「無特殊狀況」。"
    "不要輸出 markdown。"
)

PHONE_BULLET_SYSTEM = (
    "你是長照督導員的文書助理，請將以下電訪粗稿整理為"
    "專業的條列式紀錄，使用繁體中文。"
    "請直接輸出 HTML 格式，架構如下（請嚴格遵守，包括每個子項目之間的 <br> 空行）：\n\n"
    "<h5>1. 【身體狀況】</h5>\n<ul><li>…</li></ul>\n"
    "<br>\n"
    "<h5>2. 【服務狀況】</h5>\n<ul><li>…</li></ul>\n\n"
    "重要：兩個子項目之間必須加上 <br> 空行，這是強制要求。"
    "若粗稿中某些項目無相關資訊，可簡要標註「無特殊狀況」。"
    "不要使用「・」符號，不要輸出 markdown，語氣專業簡潔。"
)

PHONE_NARRATIVE_SYSTEM = (
    "你是長照督導員的文書助理，請將以下電訪粗稿整理為"
    "專業的敘述式紀錄，使用繁體中文，以流暢的段落書寫，"
    "語氣正式專業。"
    "請直接輸出 HTML 格式，架構如下（請嚴格遵守，包括每個子項目之間的 <br> 空行）：\n\n"
    "<h5>1. 【身體狀況】</h5>\n<p>…</p>\n"
    "<br>\n"
    "<h5>2. 【服務狀況】</h5>\n<p>…</p>\n\n"
    "重要：兩個子項目之間必須加上 <br> 空行，這是強制要求。"
    "若粗稿中某些項目無相關資訊，可簡要標註「無特殊狀況」。"
    "不要輸出 markdown。"
)

TONE_INSTRUCTIONS = {
    "professional": "語氣正式專業，用詞精確。",
    "warm": "語氣溫暖關懷，展現同理心，適度使用較柔和的表達方式。",
    "concise": "語氣簡潔扼要，去除冗詞贅字，每句話都直指重點。",
    "detailed": "語氣詳盡完整，盡量補充觀察細節與具體描述，讓紀錄內容更加豐富。",
}

OCR_SYSTEM = (
    "你是一個 OCR 助理，請完整辨識圖片中的所有文字，"
    "保留原始段落結構，以繁體中文輸出，不要加任何說明。"
)


def _get_client() -> AsyncOpenAI:
    return AsyncOpenAI(api_key=settings.OPENAI_API_KEY, timeout=60.0, max_retries=2)


# ---------- transcribe ----------

@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    file: UploadFile = File(...),
    _current_user: User = Depends(get_current_user),
):
    if file.content_type not in AUDIO_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"不支援的音檔格式：{file.content_type}",
        )

    content = await file.read()
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="音檔大小超過 25MB 上限",
        )

    client = _get_client()
    try:
        # OpenAI expects a file-like tuple (filename, bytes, content_type)
        result = await client.audio.transcriptions.create(
            model="whisper-1",
            file=(file.filename or "audio.webm", content, file.content_type or "audio/webm"),
            language="zh",
            response_format="verbose_json",
        )
    except openai.APIError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"OpenAI 錯誤：{str(e)}",
        )

    return TranscribeResponse(
        text=result.text,
        duration=getattr(result, "duration", 0.0) or 0.0,
    )


# ---------- OCR ----------

@router.post("/ocr", response_model=OcrResponse)
async def ocr(
    file: UploadFile = File(...),
    _current_user: User = Depends(get_current_user),
):
    if file.content_type not in IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"不支援的圖片格式：{file.content_type}",
        )

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="圖片大小超過 10MB 上限",
        )

    b64 = base64.b64encode(content).decode("utf-8")
    data_url = f"data:{file.content_type};base64,{b64}"

    client = _get_client()
    try:
        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": OCR_SYSTEM},
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": data_url}},
                        {"type": "text", "text": "請辨識這張圖片中的所有文字。"},
                    ],
                },
            ],
            max_tokens=2000,
        )
    except openai.APIError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"OpenAI OCR 錯誤：{str(e)}",
        )

    text = response.choices[0].message.content or ""
    return OcrResponse(text=text.strip())


# ---------- refine ----------

@router.post("/refine", response_model=RefineResponse)
async def refine(
    body: RefineRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not body.text.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="請提供需要潤飾的文字",
        )

    if body.visit_type == "phone":
        base_prompt = PHONE_BULLET_SYSTEM if body.format == "bullet" else PHONE_NARRATIVE_SYSTEM
    else:
        base_prompt = BULLET_SYSTEM if body.format == "bullet" else NARRATIVE_SYSTEM
    tone_hint = TONE_INSTRUCTIONS.get(body.tone, TONE_INSTRUCTIONS["professional"])
    system_prompt = f"{base_prompt}\n\n語氣風格要求：{tone_hint}"
    visit_label = "家訪" if body.visit_type == "home" else "電訪"

    client = _get_client()
    try:
        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"以下是{visit_label}粗稿：\n\n{body.text}"},
            ],
            max_tokens=2000,
        )
    except openai.APIError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"OpenAI 潤飾錯誤：{str(e)}",
        )

    refined_text = _strip_code_fences(response.choices[0].message.content or "")
    tokens_used = response.usage.total_tokens if response.usage else 0

    # Log refinement only if record_id exists (prevent FK violation on new records)
    if body.record_id:
        log = RefinementLog(
            record_id=body.record_id,
            input_text=body.text,
            output_text=refined_text,
            format_type=body.format,
            tokens_used=tokens_used,
        )
        db.add(log)
        await db.flush()

    return RefineResponse(refined_text=refined_text.strip(), tokens_used=tokens_used)


# ---------- refine-stream (SSE) ----------

def _strip_code_fences(text: str) -> str:
    """Remove markdown code fences that GPT sometimes wraps around output."""
    text = text.strip()
    if text.startswith("```"):
        first_newline = text.find("\n")
        if first_newline != -1:
            text = text[first_newline + 1:]
        text = text.strip()
    if text.endswith("```"):
        text = text[:-3].strip()
    return text


@router.post("/refine-stream")
async def refine_stream(
    body: RefineRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not body.text.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="請提供需要潤飾的文字",
        )

    if body.visit_type == "phone":
        base_prompt = PHONE_BULLET_SYSTEM if body.format == "bullet" else PHONE_NARRATIVE_SYSTEM
    else:
        base_prompt = BULLET_SYSTEM if body.format == "bullet" else NARRATIVE_SYSTEM
    tone_hint = TONE_INSTRUCTIONS.get(body.tone, TONE_INSTRUCTIONS["professional"])
    system_prompt = f"{base_prompt}\n\n語氣風格要求：{tone_hint}"
    visit_label = "家訪" if body.visit_type == "home" else "電訪"

    async def event_generator():
        client = _get_client()
        collected = ""
        tokens_used = 0
        try:
            stream = await client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"以下是{visit_label}粗稿：\n\n{body.text}"},
                ],
                max_tokens=2000,
                stream=True,
                stream_options={"include_usage": True},
            )
            async for chunk in stream:
                # Check if client disconnected
                if await request.is_disconnected():
                    return

                # Usage info comes in the final chunk
                if chunk.usage:
                    tokens_used = chunk.usage.total_tokens

                if chunk.choices and chunk.choices[0].delta.content:
                    text = chunk.choices[0].delta.content
                    collected += text
                    yield f"data: {json.dumps({'type': 'chunk', 'content': text}, ensure_ascii=False)}\n\n"

            # Send final event with cleaned full text and token count
            final_text = _strip_code_fences(collected)
            yield f"data: {json.dumps({'type': 'done', 'content': final_text, 'tokens_used': tokens_used}, ensure_ascii=False)}\n\n"

            # Log refinement
            if body.record_id:
                log = RefinementLog(
                    record_id=body.record_id,
                    input_text=body.text,
                    output_text=final_text,
                    format_type=body.format,
                    tokens_used=tokens_used,
                )
                db.add(log)
                await db.flush()

        except openai.APIError as e:
            yield f"data: {json.dumps({'type': 'error', 'message': f'OpenAI 潤飾錯誤：{str(e)}'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ---------- check-gaps ----------

GAPS_SYSTEM = (
    "你是長照督導員的文書助理。請分析以下家電訪粗稿，判斷是否缺少以下重要項目的描述：\n"
    "1. 個案生心理狀況\n"
    "2. 居家環境\n"
    "3. 主要照顧者照顧項\n"
    "4. 主要照顧者身心狀況\n"
    "5. 社交狀況\n"
    "6. 個案服務需求\n"
    "7. 居服員服務品質\n\n"
    "請只回傳 JSON 陣列，每個元素是一個物件，包含：\n"
    '- "section": 缺少的項目名稱（上述 1-7 的名稱）\n'
    '- "hint": 一句簡短的建議提示（例如「建議補充個案目前的情緒狀態與身體狀況」）\n\n'
    "如果粗稿內容充分涵蓋所有項目，請回傳空陣列 []。\n"
    "只輸出 JSON，不要加任何說明文字。"
)


@router.post("/check-gaps", response_model=CheckGapsResponse)
async def check_gaps(
    body: CheckGapsRequest,
    _current_user: User = Depends(get_current_user),
):
    if not body.text.strip():
        return CheckGapsResponse(gaps=[])

    client = _get_client()
    visit_label = "家訪" if body.visit_type == "home" else "電訪"

    try:
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": GAPS_SYSTEM},
                {"role": "user", "content": f"以下是{visit_label}粗稿：\n\n{body.text}"},
            ],
            max_tokens=500,
            temperature=0.2,
        )
    except openai.APIError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"OpenAI 錯誤：{str(e)}",
        )

    raw = response.choices[0].message.content or "[]"
    # Strip markdown code fences if present
    raw = raw.strip()
    if raw.startswith("```"):
        first_newline = raw.find("\n")
        if first_newline != -1:
            raw = raw[first_newline + 1:]
        raw = raw.strip()
    if raw.endswith("```"):
        raw = raw[:-3].strip()

    try:
        gaps = json.loads(raw)
    except json.JSONDecodeError:
        gaps = []

    return CheckGapsResponse(gaps=gaps)


# ---------- refine-section ----------

SECTION_SYSTEM = (
    "你是長照督導員的文書助理。請僅針對以下指定段落進行潤飾改寫，"
    "使用繁體中文，語氣專業簡潔。\n\n"
    "重要規則：\n"
    "1. 只輸出該段落的改寫結果，不要輸出其他段落\n"
    "2. 保留原始的 HTML 標籤結構（h4/h5/ul/li/p 等）\n"
    "3. 不要輸出 markdown，直接輸出 HTML\n"
    "4. 可以適度補充細節或改善語句流暢度，但不要改變原意\n"
)


@router.post("/refine-section", response_model=RefineSectionResponse)
async def refine_section(
    body: RefineSectionRequest,
    _current_user: User = Depends(get_current_user),
):
    if not body.section_html.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="請提供需要潤飾的段落",
        )

    fmt_hint = "條列式（使用 <ul><li>）" if body.format == "bullet" else "敘述式（使用 <p>）"
    tone_hint = TONE_INSTRUCTIONS.get(body.tone, TONE_INSTRUCTIONS["professional"])
    visit_label = "家訪" if body.visit_type == "home" else "電訪"
    section_system = f"{SECTION_SYSTEM}\n\n語氣風格要求：{tone_hint}"

    user_content = f"格式要求：{fmt_hint}\n\n以下是需要重新潤飾的{visit_label}紀錄段落：\n\n{body.section_html}"
    if body.context:
        user_content += f"\n\n以下是完整粗稿供參考上下文（不要潤飾這部分）：\n\n{body.context}"

    client = _get_client()
    try:
        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": section_system},
                {"role": "user", "content": user_content},
            ],
            max_tokens=1000,
        )
    except openai.APIError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"OpenAI 錯誤：{str(e)}",
        )

    result = _strip_code_fences(response.choices[0].message.content or "")
    tokens_used = response.usage.total_tokens if response.usage else 0

    return RefineSectionResponse(refined_html=result, tokens_used=tokens_used)
