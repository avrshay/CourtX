from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.core.auth import get_current_user
from app.core.config import get_settings
from app.core.supabase import get_supabase_client
from app.models.schemas import UploadVideoResponse

router = APIRouter(tags=["video"])


@router.post("/upload-video", response_model=UploadVideoResponse)
async def upload_video(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
) -> UploadVideoResponse:
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file must include a filename.",
        )

    supabase = get_supabase_client()
    settings = get_settings()

    session_id = uuid4()
    file_bytes = await file.read()
    storage_path = f"{current_user['id']}/{session_id}/{file.filename}"

    try:
        supabase.storage.from_(settings.supabase_storage_bucket).upload(
            path=storage_path,
            file=file_bytes,
            file_options={"content-type": file.content_type or "application/octet-stream"},
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to upload video to Supabase Storage.",
        ) from exc

    payload = {
        "user_id": current_user["id"],
        "session_id": str(session_id),
        "storage_path": storage_path,
        "raw_text": "",
        "status": "uploaded",
    }

    try:
        insert_response = supabase.table("raw_logs").insert(payload).execute()
        raw_log = insert_response.data[0]
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to initialize raw log session record.",
        ) from exc

    return UploadVideoResponse(
        session_id=session_id,
        storage_path=storage_path,
        raw_log_id=raw_log["id"],
    )
