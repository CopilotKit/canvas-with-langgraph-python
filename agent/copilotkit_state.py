from typing import Any, Dict, List, Optional
from typing_extensions import TypedDict

from langchain_core.messages import BaseMessage


class CopilotKitState(TypedDict, total=False):
    """
    Minimal state shape required by this agent to interoperate with CopilotKit AG-UI.
    This avoids importing the external 'copilotkit' Python package in serverless runtimes.
    """

    # Chat history
    messages: List[BaseMessage]

    # Envelope for frontend-provided actions/tools and metadata
    copilotkit: Dict[str, Any]

    # Guidance for post-tool messaging between turns
    __last_tool_guidance: Optional[str]

    # Optional selection captured via interrupt/chooser flow
    chosen_item_id: Optional[str]

    # Optional bookkeeping fields used throughout the app
    lastAction: str
    itemsCreated: int


