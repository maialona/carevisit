import sys
print("=== APP STARTING ===", flush=True)

from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.encoders import jsonable_encoder
from starlette.exceptions import HTTPException

print("=== FASTAPI IMPORTED ===", flush=True)

# Initialize logging
import app.core.logging as app_logging

from app.core.config import settings

print(f"=== CONFIG LOADED ===", flush=True)

# Test: import DB but catch errors
try:
    from app.core.database import engine
    print("=== DATABASE IMPORTED ===", flush=True)
except Exception as e:
    print(f"=== DATABASE IMPORT ERROR: {e} ===", flush=True)
    engine = None

try:
    from app.routers import ai, auth, chat, clients, export, records, users, stats
    print("=== ALL ROUTERS IMPORTED ===", flush=True)
    ROUTERS_OK = True
except Exception as e:
    print(f"=== ROUTER IMPORT ERROR: {e} ===", flush=True)
    ROUTERS_OK = False


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    print("=== LIFESPAN START ===", flush=True)
    yield
    print("=== LIFESPAN END ===", flush=True)
    if engine:
        await engine.dispose()


app = FastAPI(title="CareVisit 長照家電訪管理系統", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if ROUTERS_OK:
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
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": "HTTP_ERROR",
            "message": exc.detail
        }
    )

@app.exception_handler(Exception)
async def general_error_handler(request: Request, exc: Exception) -> JSONResponse:
    print(f"=== REQUEST ERROR: {exc} ===", flush=True)
    app_logging.logger.error(f"Unexpected error: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "error": "INTERNAL_ERROR",
            "message": "系統發生錯誤，請稍後再試"
        }
    )


app_logging.logger.info("CareVisit application started")
print("=== APP READY ===", flush=True)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
