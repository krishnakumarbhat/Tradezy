"""
00_main.py — FastAPI application entry point.
Why: Single entry point for the REST API; wires together routes and middleware.
Execution: uvicorn src.00_main:app --reload
"""

import sys
from pathlib import Path

# Ensure src/ is on the Python path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api import router
from utils import LoggerFactory

log = LoggerFactory.get("main")

app = FastAPI(
    title="FinResearcher",
    description="AI-powered financial research & stock prediction platform",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.on_event("startup")
async def startup():
    log.info("FinResearcher API starting")


@app.on_event("shutdown")
async def shutdown():
    log.info("FinResearcher API shutting down")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("00_main:app", host="0.0.0.0", port=8000, reload=True)
