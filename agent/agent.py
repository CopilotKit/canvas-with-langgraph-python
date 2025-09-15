"""
Canvas with LangGraph - Agent implementation
"""

import sys

# Patch for CopilotKit v0.1.63 import bug
if 'langgraph.graph.graph' not in sys.modules:
    class _MockModule:
        pass
    import langgraph
    import langgraph.graph
    import langgraph.graph.state
    from langgraph.graph.state import CompiledStateGraph
    _mock_graph_module = _MockModule()
    _mock_graph_module.CompiledGraph = CompiledStateGraph
    sys.modules['langgraph.graph.graph'] = _mock_graph_module
import json
from typing import Any, List, Optional, Dict
from typing_extensions import Literal
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, BaseMessage, HumanMessage, AIMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain.tools import tool
from langgraph.graph import StateGraph, END
from langgraph.types import Command
from copilotkit import CopilotKitState
from copilotkit.langgraph import copilotkit_interrupt
from langgraph.prebuilt import ToolNode
from langgraph.types import interrupt

class AgentState(CopilotKitState):
    """Agent state extending CopilotKitState with canvas-specific fields."""
    tools: List[Any] = []
    items: List[Dict[str, Any]] = []
    globalTitle: str = ""
    globalDescription: str = ""
    planSteps: List[Dict[str, Any]] = []
    currentStepIndex: int = -1
    planStatus: str = ""
def summarize_items_for_prompt(state: AgentState) -> str:
    """Create a human-readable summary of all items for the prompt."""
    try:
        items = state.get("items", []) or []
        if not items:
            return "(no items)"
        
        lines = []
        for item in items:
            item_id = item.get("id", "")
            name = item.get("name", "")
            item_type = item.get("type", "")
            data = item.get("data", {}) or {}
            subtitle = item.get("subtitle", "")
            
            # Build summary based on item type
            if item_type == "project":
                checklist = ", ".join([c.get("text", "") for c in data.get("field4", [])])
                summary = (f"subtitle={subtitle} · field1={data.get('field1', '')} · "
                          f"field2={data.get('field2', '')} · field3={data.get('field3', '')} · "
                          f"field4=[{checklist}]")
            elif item_type == "entity":
                tags = ", ".join(data.get("field3", []))
                opts = ", ".join(data.get("field3_options", []))
                summary = (f"subtitle={subtitle} · field1={data.get('field1', '')} · "
                          f"field2={data.get('field2', '')} · field3(tags)=[{tags}] · "
                          f"field3_options=[{opts}]")
            elif item_type == "note":
                summary = f"subtitle={subtitle} · noteContent=\"{data.get('field1', '')}\""
            elif item_type == "chart":
                metrics = ", ".join([f"{m.get('label','')}:{m.get('value', 0)}%" 
                                   for m in data.get("field1", [])])
                summary = f"subtitle={subtitle} · field1(metrics)=[{metrics}]"
            else:
                summary = f"subtitle={subtitle}"
            
            lines.append(f"id={item_id} · name={name} · type={item_type} · {summary}")
        
        return "\n".join(lines)
    except Exception:
        return "(unable to summarize items)"


@tool
def get_weather(location: str):
    """Get the weather for a given location."""
    return f"The weather for {location} is 70 degrees."

@tool
def set_plan(steps: List[str]):
    """Initialize a plan with step descriptions."""
    return {"initialized": True, "steps": steps}

@tool
def update_plan_progress(step_index: int, status: Literal["pending", "in_progress", "completed", "blocked", "failed"], note: Optional[str] = None):
    """Update a plan step's status and optionally add a note."""
    return {"updated": True, "index": step_index, "status": status, "note": note}

@tool
def complete_plan():
    """Mark the plan as completed."""
    return {"completed": True}

backend_tools = [
    get_weather,
    set_plan,
    update_plan_progress,
    complete_plan,
]

# Extract tool names from backend_tools for comparison
backend_tool_names = [tool.name for tool in backend_tools]

# Frontend tool allowlist to keep tool count under API limits and avoid noise
FRONTEND_TOOL_ALLOWLIST = set([
    "setGlobalTitle",
    "setGlobalDescription",
    "setItemName",
    "setItemSubtitleOrDescription",
    "setItemDescription",
    # note
    "setNoteField1",
    "appendNoteField1",
    "clearNoteField1",
    # project
    "setProjectField1",
    "setProjectField2",
    "setProjectField3",
    "clearProjectField3",
    "addProjectChecklistItem",
    "setProjectChecklistItem",
    "removeProjectChecklistItem",
    # entity
    "setEntityField1",
    "setEntityField2",
    "addEntityField3",
    "removeEntityField3",
    # chart
    "addChartField1",
    "setChartField1Label",
    "setChartField1Value",
    "clearChartField1Value",
    "removeChartField1",
    # items
    "createItem",
    "deleteItem",
])


def _extract_tool_name(tool: Any) -> Optional[str]:
    """Extract tool name from LangChain tool or OpenAI function spec."""
    try:
        if isinstance(tool, dict):
            fn = tool.get("function", {}) if isinstance(tool.get("function", {}), dict) else {}
            name = fn.get("name") or tool.get("name")
            if isinstance(name, str) and name.strip():
                return name
        else:
            name = getattr(tool, "name", None)
            if isinstance(name, str) and name.strip():
                return name
        return None
    except Exception:
        return None


def _predict_plan_updates(response: BaseMessage, plan_steps: List[Dict], current_step_index: int, plan_status: str) -> Dict[str, Any]:
    """Predict plan state updates based on tool calls in the response."""
    try:
        tool_calls = getattr(response, "tool_calls", []) or []
        if not tool_calls:
            return {}
            
        predicted_steps = plan_steps.copy()
        predicted_index = current_step_index
        predicted_status = plan_status
        
        for tc in tool_calls:
            name = tc.get("name") if isinstance(tc, dict) else getattr(tc, "name", None)
            args = tc.get("args") if isinstance(tc, dict) else getattr(tc, "args", {})
            
            # Parse args if needed
            if not isinstance(args, dict):
                try:
                    args = json.loads(args)
                except Exception:
                    args = {}
            
            # Handle plan operations
            if name == "set_plan":
                steps = args.get("steps", [])
                predicted_steps = [{"title": str(s), "status": "pending"} for s in steps]
                if predicted_steps:
                    predicted_steps[0]["status"] = "in_progress"
                    predicted_index = 0
                    predicted_status = "in_progress"
                    
            elif name == "update_plan_progress":
                idx = args.get("step_index")
                status = args.get("status")
                note = args.get("note")
                if isinstance(idx, int) and 0 <= idx < len(predicted_steps):
                    predicted_steps[idx]["status"] = status
                    if note:
                        predicted_steps[idx]["note"] = note
                    if status == "in_progress":
                        predicted_index = idx
                        predicted_status = "in_progress"
                        
            elif name == "complete_plan":
                predicted_status = "completed"
                for step in predicted_steps:
                    if step.get("status") != "completed":
                        step["status"] = "completed"
        
        # Build updates dict
        updates = {}
        if predicted_steps != plan_steps:
            updates["planSteps"] = predicted_steps
        if predicted_index != current_step_index:
            updates["currentStepIndex"] = predicted_index
        if predicted_status != plan_status:
            updates["planStatus"] = predicted_status
            
        return updates
    except Exception:
        return {}


def _validate_message_sequence(messages: List[Any]) -> List[Any]:
    """Validate and fix message sequence to ensure tool messages have corresponding calls."""
    if not messages:
        return messages
    
    validated = []
    tool_call_ids = set()
    
    # First, collect all system messages (they should go first)
    system_messages = [msg for msg in messages if isinstance(msg, SystemMessage)]
    validated.extend(system_messages)
    
    # Then process the rest
    for msg in messages:
        if isinstance(msg, SystemMessage):
            continue  # Already added
            
        # Track tool calls from AI messages
        if hasattr(msg, 'tool_calls') and msg.tool_calls:
            for tc in msg.tool_calls:
                tc_id = tc.get('id') if isinstance(tc, dict) else getattr(tc, 'id', None)
                if tc_id:
                    tool_call_ids.add(tc_id)
            validated.append(msg)
        
        # Check tool messages
        elif isinstance(msg, ToolMessage):
            if hasattr(msg, 'tool_call_id') and msg.tool_call_id in tool_call_ids:
                validated.append(msg)
                tool_call_ids.remove(msg.tool_call_id)  # Mark as used
            else:
                # Orphaned tool message - skip it
                print(f"Warning: Skipping orphaned tool message with ID {getattr(msg, 'tool_call_id', 'unknown')}")
        
        # Regular messages (Human, AI without tools)
        else:
            validated.append(msg)
    
    return validated


def _trim_messages_safely(messages: List[Any], max_messages: int) -> List[Any]:
    """Trim messages to recent context, preserving complete conversations."""
    if len(messages) <= max_messages:
        return messages
    
    # Keep the most recent messages
    # The validation function will handle any orphaned tool messages
    return messages[-max_messages:]


def _has_pending_frontend_tools(messages: List[Any], backend_tool_names: List[str]) -> bool:
    """Check if the last message has unresolved frontend tool calls."""
    try:
        if messages:
            last_msg = messages[-1]
            if isinstance(last_msg, AIMessage):
                for tc in getattr(last_msg, "tool_calls", []) or []:
                    name = tc.get("name") if isinstance(tc, dict) else getattr(tc, "name", None)
                    if name and name not in backend_tool_names:
                        return True
        return False
    except Exception:
        return False


def _preserve_state(state: AgentState) -> Dict[str, Any]:
    """Return a dict with all shared state fields preserved."""
    return {
        "items": state.get("items", []),
        "globalTitle": state.get("globalTitle", ""),
        "globalDescription": state.get("globalDescription", ""),
        "itemsCreated": state.get("itemsCreated", 0),
        "lastAction": state.get("lastAction", ""),
        "planSteps": state.get("planSteps", []),
        "currentStepIndex": state.get("currentStepIndex", -1),
        "planStatus": state.get("planStatus", ""),
    }


def _prepare_frontend_tools(state: AgentState) -> List[Any]:
    """Extract, deduplicate, and filter frontend tools."""
    raw_tools = state.get("tools", []) or []
    
    # Get tools from CopilotKit envelope
    try:
        ck = state.get("copilotkit", {}) or {}
        raw_actions = ck.get("actions", []) or []
        if isinstance(raw_actions, list) and raw_actions:
            raw_tools = [*raw_tools, *raw_actions]
    except Exception:
        pass

    # Deduplicate and filter tools
    deduped_tools = []
    seen = set()
    for tool in raw_tools:
        name = _extract_tool_name(tool)
        if not name or name in seen or name not in FRONTEND_TOOL_ALLOWLIST:
            continue
        seen.add(name)
        deduped_tools.append(tool)

    # Cap to avoid OpenAI limits
    MAX_FRONTEND_TOOLS = 110
    return deduped_tools[:MAX_FRONTEND_TOOLS]


async def chat_node(state: AgentState, config: RunnableConfig) -> Command[Literal["tool_node", "__end__"]]:
    """Main chat node implementing ReAct pattern for handling conversations and tool calls."""
    # Clean up any orphaned tool messages at the start
    messages = state.get("messages", [])
    if messages:
        # Remove any tool messages that appear before any AI messages with tool calls
        cleaned_messages = []
        has_tool_calls = False
        for msg in messages:
            if hasattr(msg, 'tool_calls') and msg.tool_calls:
                has_tool_calls = True
            if isinstance(msg, ToolMessage) and not has_tool_calls:
                print(f"Removing orphaned tool message at start: {getattr(msg, 'tool_call_id', 'unknown')}")
                continue
            cleaned_messages.append(msg)
        state["messages"] = cleaned_messages
    
    model = ChatOpenAI(model="gpt-4o")
    
    # Prepare tools
    frontend_tools = _prepare_frontend_tools(state)
    model_with_tools = model.bind_tools(
        [*frontend_tools, *backend_tools],
        parallel_tool_calls=False,
    )

    # Build system message
    items_summary = summarize_items_for_prompt(state)
    global_title = state.get("globalTitle", "")
    global_description = state.get("globalDescription", "")
    post_tool_guidance = state.get("__last_tool_guidance", None)
    last_action = state.get("lastAction", "")
    plan_steps = state.get("planSteps", []) or []
    current_step_index = state.get("currentStepIndex", -1)
    plan_status = state.get("planStatus", "")
    field_schema = """FIELD SCHEMA:
- project: field1 (text), field2 (select: A/B/C), field3 (date YYYY-MM-DD), field4 (checklist items)
- entity: field1 (text), field2 (select: A/B/C), field3 (selected tags from field3_options)
- note: field1 (content/description)
- chart: field1 (metrics array with label and value 0-100)
- All types have subtitle (card subtitle)"""

    loop_control = """LOOP CONTROL:
- Never repeat the same tool in one turn
- After mutations, summarize and stop
- If lastAction shows 'created:', don't auto-create more unless explicitly asked"""

    system_message = SystemMessage(
        content=f"""CURRENT STATE:
globalTitle: {global_title}
globalDescription: {global_description}
items:\n{items_summary}
lastAction: {last_action}
planStatus: {plan_status} (step {current_step_index})
planSteps: {[s.get('title', s) for s in plan_steps]}

{field_schema}

CORE RULES:
- Always use current state as ground truth, not chat history
- When changing items, MUST call corresponding tools
- For descriptions/subtitles: use setItemSubtitleOrDescription (not data fields)
- For note content: use setNoteField1/appendNoteField1
- If item not specified, check lastAction or ask user to choose

PLANNING:
- For multi-step tasks, call set_plan with step titles
- Auto-proceed through steps: update_plan_progress → execute → mark completed
- Call complete_plan only after verifying all deliverables exist

{loop_control}

{post_tool_guidance if post_tool_guidance else ""}""")

    # Handle interrupts for item selection
    try:
        last_user = next((m for m in reversed(state["messages"]) if getattr(m, "type", "") == "human"), None)
        if last_user and any(k in last_user.content.lower() for k in ["item", "rename", "update", "modify", "change", "edit"]) and not any(k in last_user.content.lower() for k in ["id=", "item id", "0001", "0002", "0003", "0004"]):
            items = state.get("items", [])
            if len(items) > 1:  # Only interrupt if there are multiple items to choose from
                result = copilotkit_interrupt(
                    message=json.dumps({
                        "type": "choose_item",
                        "content": "Please choose which item you mean.",
                    })
                )
                if result and result.get("answer"):
                    state["chosen_item_id"] = result["answer"]
    except Exception:
        pass

    # Check if user wants to create an item but didn't specify the type
    try:
        last_user = next((m for m in reversed(state["messages"]) if getattr(m, "type", "") == "human"), None)
        if last_user and any(k in last_user.content.lower() for k in ["create", "add", "new"]) and any(k in last_user.content.lower() for k in ["item", "card"]) and not any(k in last_user.content.lower() for k in ["project", "entity", "note", "chart"]):
            result = copilotkit_interrupt(
                message=json.dumps({
                    "type": "choose_card_type",
                    "content": "Which type of card should I create?",
                })
            )
            if result and result.get("answer"):
                # Append a clarifying message to guide the model
                state["messages"].append(HumanMessage(content=f"Create a {result['answer']} item."))
    except Exception:
        pass

    # Check if we need to wait for frontend tool responses
    full_messages = state.get("messages", []) or []
    if _has_pending_frontend_tools(full_messages, backend_tool_names):
        return Command(goto=END, update=_preserve_state(state))

    # Trim messages while preserving tool call/response pairs
    trimmed_messages = _trim_messages_safely(full_messages, 12)

    # Append latest state snapshot to ensure accuracy
    latest_state_system = SystemMessage(
        content=f"""LATEST STATE (use this, not chat history):
globalTitle: {global_title}
globalDescription: {global_description}
items:\n{items_summary}
lastAction: {last_action}
planStatus: {plan_status} (step {current_step_index})
""")

    # Validate message sequence before sending to OpenAI
    messages_to_send = [system_message, *trimmed_messages, latest_state_system]
    validated_messages = _validate_message_sequence(messages_to_send)
    
    # Debug logging
    for i, msg in enumerate(validated_messages[:5]):  # Log first 5 messages
        msg_type = type(msg).__name__
        if isinstance(msg, ToolMessage):
            print(f"Message {i}: {msg_type} (tool_call_id: {getattr(msg, 'tool_call_id', 'N/A')})")
        elif hasattr(msg, 'tool_calls') and msg.tool_calls:
            tc_ids = [tc.get('id') if isinstance(tc, dict) else getattr(tc, 'id', None) 
                     for tc in msg.tool_calls]
            print(f"Message {i}: {msg_type} with tool_calls: {tc_ids}")
        else:
            print(f"Message {i}: {msg_type}")
    
    response = await model_with_tools.ainvoke(validated_messages, config)

    # Update plan state based on tool calls
    plan_updates = _predict_plan_updates(response, plan_steps, current_step_index, plan_status)

    # Route to tool node if backend tools were called
    if route_to_tool_node(response):
        return Command(
            goto="tool_node",
            update={
                "messages": [response],
                **_preserve_state(state),
                **plan_updates,
                "__last_tool_guidance": "If a deletion tool reports success (deleted:ID), acknowledge deletion even if the item no longer exists afterwards."
            }
        )

    # 5. If there are remaining steps, auto-continue; otherwise end the graph.
    try:
        effective_steps = plan_updates.get("planSteps", plan_steps)
        effective_plan_status = plan_updates.get("planStatus", plan_status)
        has_remaining = bool(effective_steps) and any(
            (s.get("status") not in ("completed", "failed")) for s in effective_steps
        )
    except Exception:
        effective_steps = plan_steps
        effective_plan_status = plan_status
        has_remaining = False

    # Determine if this response contains frontend tool calls that must be delivered to the client
    try:
        tool_calls = getattr(response, "tool_calls", []) or []
    except Exception:
        tool_calls = []
    has_frontend_tool_calls = False
    for tc in tool_calls:
        name = tc.get("name") if isinstance(tc, dict) else getattr(tc, "name", None)
        if name and name not in backend_tool_names:
            has_frontend_tool_calls = True
            break

    # If the model produced FRONTEND tool calls, deliver them to the client and stop the turn.
    # The client will execute and post ToolMessage(s), after which the next run can resume.
    if has_frontend_tool_calls:
        return Command(
            goto=END,
            update={
                "messages": [response],
                **_preserve_state(state),
                **plan_updates,
                "__last_tool_guidance": "Frontend tool calls issued. Waiting for client tool results before continuing.",
            },
        )

    if has_remaining and effective_plan_status != "completed":
        # Auto-continue; always include the response message
        return Command(
            goto="chat_node",
            update={
                "messages": [response],
                **_preserve_state(state),
                **plan_updates,
                "__last_tool_guidance": (
                    "Plan is in progress. Proceed to the next step automatically. "
                    "Update the step status to in_progress, call necessary tools, and mark it completed when done."
                ),
            }
        )

    # If all steps look completed but planStatus is not yet 'completed', nudge the model to call complete_plan
    try:
        all_steps_completed = bool(effective_steps) and all((s.get("status") == "completed") for s in effective_steps)
        plan_marked_completed = (effective_plan_status == "completed")
    except Exception:
        all_steps_completed = False
        plan_marked_completed = False

    if all_steps_completed and not plan_marked_completed:
        return Command(
            goto="chat_node",
            update={
                "messages": [response],
                **_preserve_state(state),
                **plan_updates,
                "__last_tool_guidance": (
                    "All steps are completed. Call complete_plan to mark the plan as finished, "
                    "then present a concise summary of outcomes."
                ),
            }
        )

    # Always show messages from the agent - they should never disappear
    return Command(
        goto=END,
        update={
            "messages": [response],
            **_preserve_state(state),
            **plan_updates,
            "__last_tool_guidance": None,
        }
    )

def route_to_tool_node(response: BaseMessage):
    """
    Route to tool node if any tool call in the response matches a backend tool name.
    """
    tool_calls = getattr(response, "tool_calls", None)
    if not tool_calls:
        return False

    for tool_call in tool_calls:
        name = tool_call.get("name")
        if name in backend_tool_names:
            return True
    return False

# Define the workflow graph
workflow = StateGraph(AgentState)
workflow.add_node("chat_node", chat_node)
workflow.add_node("tool_node", ToolNode(tools=backend_tools))
workflow.add_edge("tool_node", "chat_node")
workflow.set_entry_point("chat_node")

graph = workflow.compile()
