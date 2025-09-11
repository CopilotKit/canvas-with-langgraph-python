from typing import Any, AsyncGenerator, Dict, Optional

import asyncio
import json
import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse


# Ensure the Python path can import the agent module from the repository root
# Vercel sets CWD to the project base, so a plain package import should work
# as long as `agent/` is a package. We add a defensive sys.path update in case
# this file is moved or imported in a different context.
try:
    from agent.agent import graph  # type: ignore
except Exception:
    import sys
    from os.path import abspath, dirname, join

    repo_root = dirname(dirname(abspath(__file__)))
    if repo_root not in sys.path:
        sys.path.append(repo_root)
    try:
        from agent.agent import graph  # type: ignore
    except Exception as import_exc:  # pragma: no cover
        raise import_exc


app = FastAPI()


@app.get("/")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


def _extract_json_body(body: Any) -> Dict[str, Any]:
    if isinstance(body, dict):
        return body
    try:
        return json.loads(body)
    except Exception:
        return {}


@app.post("/graphs/{graph_id}/invoke")
async def invoke_graph(graph_id: str, request: Request) -> JSONResponse:
    if graph_id != "sample_agent":
        raise HTTPException(status_code=404, detail="Unknown graph_id")

    body_raw = await request.body()
    body = _extract_json_body(body_raw)
    # Accept either {"input": {...}} or a full state as the body
    input_state: Dict[str, Any] = body.get("input") if isinstance(body.get("input"), dict) else body

    try:
        # Prefer async invoke to avoid blocking the event loop
        result: Dict[str, Any] = await graph.ainvoke(input_state)
        return JSONResponse(content=result)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc))


async def _sse_generator(payload: Dict[str, Any]) -> AsyncGenerator[bytes, None]:
    # Stream LangGraph events as SSE-compatible chunks
    try:
        async for event in graph.astream_events(payload, version="v1"):
            # Normalize to a simple SSE data message
            chunk = {"event": event.get("event"), "data": event}
            data = json.dumps(chunk, ensure_ascii=False)
            yield (f"data: {data}\n\n").encode("utf-8")
            # Yield control to the loop to improve responsiveness
            await asyncio.sleep(0)  # noqa: ASYNC101
    except Exception as exc:  # pragma: no cover
        err = json.dumps({"error": str(exc)})
        yield (f"data: {err}\n\n").encode("utf-8")


@app.post("/graphs/{graph_id}/stream")
async def stream_graph(graph_id: str, request: Request) -> StreamingResponse:
    if graph_id != "sample_agent":
        raise HTTPException(status_code=404, detail="Unknown graph_id")

    body_raw = await request.body()
    body = _extract_json_body(body_raw)
    payload: Dict[str, Any] = body.get("input") if isinstance(body.get("input"), dict) else body

    return StreamingResponse(
        _sse_generator(payload),
        media_type="text/event-stream",
        headers={
            # Helpful for browsers and proxies
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disable buffering on some proxies
        },
    )


