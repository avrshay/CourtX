from fastapi import APIRouter, Depends

from app.core.auth import get_current_user
from app.core.supabase import get_supabase_client
from app.models.schemas import AlertOut

router = APIRouter(tags=["alerts"])


@router.get("/alerts", response_model=list[AlertOut])
async def get_alerts(current_user: dict = Depends(get_current_user)) -> list[AlertOut]:
    supabase = get_supabase_client()
    query = (
        supabase.table("alerts")
        .select("id,user_id,session_id,title,message,severity,created_at")
        .eq("user_id", current_user["id"])
        .order("created_at", desc=True)
    )
    response = query.execute()

    return [AlertOut(**row) for row in response.data]
