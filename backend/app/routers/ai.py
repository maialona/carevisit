from __future__ import annotations

import base64
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.ext.asyncio import AsyncSession
from openai import AsyncOpenAI
import openai

from app.core.config import settings
from app.core.database import get_db
from app.deps import get_current_user
from app.models.models import RefinementLog, User
from app.schemas.schemas import (
    OcrResponse,
    RefineRequest,
    RefineResponse,
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

OCR_SYSTEM = (
    "你是一個 OCR 助理，請完整辨識圖片中的所有文字，"
    "保留原始段落結構，以繁體中文輸出，不要加任何說明。"
)


def _get_client() -> AsyncOpenAI:
    return AsyncOpenAI(api_key=settings.OPENAI_API_KEY, timeout=30.0, max_retries=2)


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

    system_prompt = BULLET_SYSTEM if body.format == "bullet" else NARRATIVE_SYSTEM
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

    refined_text = response.choices[0].message.content or ""
    # Strip markdown code fences (```html ... ```) that GPT sometimes wraps around output
    refined_text = refined_text.strip()
    if refined_text.startswith("```"):
        # Remove opening fence (e.g. ```html or ```)
        first_newline = refined_text.find("\n")
        if first_newline != -1:
            refined_text = refined_text[first_newline + 1:]
        refined_text = refined_text.strip()
    if refined_text.endswith("```"):
        refined_text = refined_text[:-3].strip()
    tokens_used = response.usage.total_tokens if response.usage else 0

    # Log refinement
    log = RefinementLog(
        record_id=body.record_id or uuid.uuid4(),
        input_text=body.text,
        output_text=refined_text,
        format_type=body.format,
        tokens_used=tokens_used,
    )
    db.add(log)
    await db.flush()

    return RefineResponse(refined_text=refined_text.strip(), tokens_used=tokens_used)
