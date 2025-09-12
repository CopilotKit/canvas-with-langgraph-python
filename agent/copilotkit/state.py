from typing import Any, Dict, List, Optional
from typing_extensions import TypedDict

from langchain_core.messages import BaseMessage


class CopilotKitState(TypedDict, total=False):
    messages: List[BaseMessage]
    copilotkit: Dict[str, Any]
    __last_tool_guidance: Optional[str]
    chosen_item_id: Optional[str]
    lastAction: str
    itemsCreated: int


