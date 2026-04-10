from abc import ABC, abstractmethod
from typing import Any


class BaseVLMService(ABC):
    """Provider-agnostic contract for video understanding services."""

    @abstractmethod
    async def process_video(self, video_url: str, session_id: str) -> dict[str, Any]:
        raise NotImplementedError


class BaseLLMService(ABC):
    """Provider-agnostic contract for text analysis and insight extraction."""

    @abstractmethod
    async def analyze_raw_log(self, raw_text: str, session_id: str) -> dict[str, Any]:
        raise NotImplementedError
