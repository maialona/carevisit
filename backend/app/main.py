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
from app.routers import ai, audit, auth, case_profiles, chat, clients, export, records, users, stats, schedule, token_analytics


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # Ensure avatar column exists (for databases created before avatar feature)
    from sqlalchemy import text
    async with engine.begin() as conn:
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar VARCHAR(50)"
        ))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS case_profiles (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL REFERENCES organizations(id),
                id_number VARCHAR(20) NOT NULL,
                name VARCHAR(100) NOT NULL,
                supervisor VARCHAR(100),
                gender VARCHAR(10),
                service_status VARCHAR(50),
                phone VARCHAR(30),
                address VARCHAR(300),
                district VARCHAR(50),
                road VARCHAR(100),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(org_id, id_number)
            )
        """))
        await conn.execute(text("""
            ALTER TABLE visit_records
              ADD COLUMN IF NOT EXISTS case_profile_id UUID
              REFERENCES case_profiles(id) ON DELETE SET NULL
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS visit_schedules (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                case_profile_id UUID NOT NULL UNIQUE REFERENCES case_profiles(id) ON DELETE CASCADE,
                preferred_day_of_month INTEGER CHECK (preferred_day_of_month BETWEEN 1 AND 28),
                reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS monthly_visit_schedules (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                case_profile_id UUID NOT NULL REFERENCES case_profiles(id) ON DELETE CASCADE,
                year INTEGER NOT NULL,
                month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
                preferred_day INTEGER NOT NULL CHECK (preferred_day BETWEEN 1 AND 28),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(case_profile_id, year, month)
            )
        """))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS can_create_case BOOLEAN NOT NULL DEFAULT FALSE"
        ))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS can_delete_case BOOLEAN NOT NULL DEFAULT FALSE"
        ))
        # Backfill org_name with case district for records linked to a case profile
        await conn.execute(text("""
            UPDATE visit_records vr
            SET org_name = COALESCE(cp.district, '')
            FROM case_profiles cp
            WHERE vr.case_profile_id = cp.id
              AND vr.org_name IS DISTINCT FROM COALESCE(cp.district, '')
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS audit_logs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL REFERENCES organizations(id),
                actor_id UUID NOT NULL REFERENCES users(id),
                actor_name VARCHAR(100) NOT NULL,
                action VARCHAR(50) NOT NULL,
                resource_type VARCHAR(50) NOT NULL,
                resource_id VARCHAR(100),
                resource_label VARCHAR(200),
                detail JSONB,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
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
app.include_router(case_profiles.router, prefix="/api")
app.include_router(schedule.router, prefix="/api")
app.include_router(audit.router, prefix="/api")
app.include_router(token_analytics.router, prefix="/api")


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
