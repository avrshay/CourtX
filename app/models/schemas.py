from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class UploadVideoResponse(BaseModel):
    session_id: UUID
    storage_path: str
    raw_log_id: UUID
    message: str = "Video uploaded and session initialized."


class AlertOut(BaseModel):
    id: UUID
    user_id: UUID
    session_id: UUID
    title: str
    message: str
    severity: str = Field(description="low | medium | high")
    created_at: datetime
