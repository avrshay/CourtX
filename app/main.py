from fastapi import FastAPI

from app.api.alerts import router as alerts_router
from app.api.upload import router as upload_router


app = FastAPI(
    title="CourtX Backend",
    version="0.1.0",
    description="MVP backend for real-time basketball analytics.",
)

app.include_router(upload_router, prefix="/api")
app.include_router(alerts_router, prefix="/api")


@app.get("/health", tags=["system"])
async def healthcheck() -> dict[str, str]:
    return {"status": "ok"}
