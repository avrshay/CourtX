from typing import Any

from app.services.base import BaseLLMService, BaseVLMService


class PlaceholderVLMService(BaseVLMService):
    async def process_video(self, video_url: str, session_id: str) -> dict[str, Any]:
        return {
            "provider": "placeholder",
            "video_url": video_url,
            "session_id": session_id,
            "raw_text": "",
            "status": "queued",
        }


class PlaceholderLLMService(BaseLLMService):
    async def analyze_raw_log(self, raw_text: str, session_id: str) -> dict[str, Any]:
        return {
            "provider": "placeholder",
            "session_id": session_id,
            "alerts": [],
            "status": "not_implemented",
        }
