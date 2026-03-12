import sys
print("=== APP STARTING ===", flush=True)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

print("=== FASTAPI IMPORTED ===", flush=True)

app = FastAPI(title="CareVisit Minimal Test")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

print("=== APP CREATED ===", flush=True)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/")
async def root():
    return {"status": "ok", "message": "CareVisit backend is running"}
