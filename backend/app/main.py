from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.encoders import jsonable_encoder
from starlette.exceptions import HTTPException

# Initialize logging
import app.core.logging as app_logging

from app.core.config import settings
from app.core.database import engine
from app.routers import ai, auth, chat, clients, export, records, users, stats


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # Ensure avatar column exists (for databases created before avatar feature)
    from sqlalchemy import text
    async with engine.begin() as conn:
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar VARCHAR(50)"
        ))
    yield
    await engine.dispose()


app = FastAPI(title="CareVisit 長照家電訪管理系統", lifespan=lifespan)

# CORS: allow all origins for Zeabur deployment compatibility
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(export.router, prefix="/api")
app.include_router(records.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(stats.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(clients.router, prefix="/api")


def decode_bytes(obj):
    if isinstance(obj, bytes):
        return obj.decode("utf-8", errors="replace")
    elif isinstance(obj, dict):
        return {k: decode_bytes(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [decode_bytes(item) for item in obj]
    elif isinstance(obj, tuple):
        return tuple(decode_bytes(item) for item in obj)
    return obj

@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    # Safely convert Pydantic validation errors objects containing bytes into strings
    safe_errors = decode_bytes(exc.errors())

    return JSONResponse(
        status_code=422,
        content={
            "error": "VALIDATION_ERROR",
            "message": "輸入資料格式有誤",
            "details": jsonable_encoder(safe_errors)
        }
    )

@app.exception_handler(HTTPException)
async def http_error_handler(request: Request, exc: HTTPException) -> JSONResponse:
    # Handle FastAPI HTTPException which uses 'detail'
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": "HTTP_ERROR",
            "message": exc.detail
        }
    )

@app.exception_handler(Exception)
async def general_error_handler(request: Request, exc: Exception) -> JSONResponse:
    app_logging.logger.error(f"Unexpected error: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "error": "INTERNAL_ERROR",
            "message": "系統發生錯誤，請稍後再試"
        }
    )


@app.get("/api/health")
async def health():
    return {"status": "ok"}
