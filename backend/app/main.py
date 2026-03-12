import sys
print("=== APP STARTING ===", flush=True)
print("=== APP STARTING ===", flush=True, file=sys.stderr)

try:
    from contextlib import asynccontextmanager
    from collections.abc import AsyncGenerator
    print("=== STDLIB IMPORTED ===", flush=True)

    from fastapi import FastAPI, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse
    from fastapi.exceptions import RequestValidationError
    from fastapi.encoders import jsonable_encoder
    from starlette.exceptions import HTTPException
    print("=== FASTAPI IMPORTED ===", flush=True)

    # Initialize logging
    import app.core.logging as app_logging
    print("=== LOGGING IMPORTED ===", flush=True)

    from app.core.config import settings
    print(f"=== CONFIG LOADED, DB={settings.DATABASE_URL[:30]}... ===", flush=True)

    from app.core.database import engine
    print("=== DATABASE IMPORTED ===", flush=True)

    from app.routers import ai, auth, chat, clients, export, records, users, stats
    print("=== ALL ROUTERS IMPORTED ===", flush=True)
except Exception as e:
    print(f"=== IMPORT ERROR: {e} ===", flush=True)
    print(f"=== IMPORT ERROR: {e} ===", flush=True, file=sys.stderr)
    raise


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    yield
    await engine.dispose()


app = FastAPI(title="CareVisit 長照家電訪管理系統", lifespan=lifespan)

_origins = [url.strip() for url in settings.FRONTEND_URL.split(",") if url.strip()]
# Always include Zeabur deployment URLs regardless of .env override
for _zeabur_url in [
    "https://carevisit-squy.zeabur.app",
    "https://carevisit.zeabur.app",
]:
    if _zeabur_url not in _origins:
        _origins.append(_zeabur_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
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


app_logging.logger.info("CareVisit application started")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
