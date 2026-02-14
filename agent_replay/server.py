"""FastAPI web server for agent-replay."""

from __future__ import annotations

import asyncio
import hashlib
import sys
import webbrowser
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from .parser import parse
from .scanner import scan_sessions

WEB_DIR = Path(__file__).parent.parent / "web"

app = FastAPI(title="agent-replay")
app.mount("/static", StaticFiles(directory=str(WEB_DIR)), name="static")


@app.get("/", response_class=HTMLResponse)
async def index():
    return FileResponse(WEB_DIR / "index.html")


@app.get("/api/sessions")
async def list_sessions():
    summaries = scan_sessions()
    return [s.to_dict() for s in summaries]


@app.get("/api/session/{session_id:path}")
async def get_session(session_id: str):
    """Parse and return a full session by file path (base64 or direct)."""
    # session_id is the file path
    file_path = Path(session_id)
    if not file_path.exists():
        # Try finding by session ID in known locations
        summaries = scan_sessions()
        for s in summaries:
            if s.id == session_id or s.file_path == session_id:
                file_path = Path(s.file_path)
                break
    if not file_path.exists():
        return {"error": "Session not found"}
    session = parse(file_path)
    return session.to_dict()


@app.websocket("/ws/session/{session_id:path}")
async def ws_session(websocket: WebSocket, session_id: str):
    """Live updates for a single session — polls file every 2s, sends deltas."""
    await websocket.accept()

    # Resolve file path
    file_path = Path(session_id)
    if not file_path.exists():
        summaries = scan_sessions()
        for s in summaries:
            if s.id == session_id or s.file_path == session_id:
                file_path = Path(s.file_path)
                break
    if not file_path.exists():
        await websocket.send_json({"error": "Session not found"})
        await websocket.close()
        return

    # Send initial full state
    session = parse(file_path)
    data = session.to_dict()
    await websocket.send_json({"type": "full", "data": data})
    last_count = len(session.events)
    last_hash = _file_hash(file_path)

    try:
        while True:
            await asyncio.sleep(2)
            current_hash = _file_hash(file_path)
            if current_hash != last_hash:
                last_hash = current_hash
                session = parse(file_path)
                if len(session.events) > last_count:
                    new_events = [e.to_dict() for e in session.events[last_count:]]
                    # Also send updated agents (tokens may have changed)
                    agents = {k: v.to_dict() for k, v in session.agents.items()}
                    await websocket.send_json({
                        "type": "delta",
                        "events": new_events,
                        "agents": agents,
                        "total_events": len(session.events),
                    })
                    last_count = len(session.events)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass


@app.websocket("/ws/dashboard")
async def ws_dashboard(websocket: WebSocket):
    """Live updates for the dashboard — polls session list every 10s."""
    await websocket.accept()
    try:
        while True:
            summaries = scan_sessions()
            await websocket.send_json({
                "type": "sessions",
                "data": [s.to_dict() for s in summaries],
            })
            await asyncio.sleep(10)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass


def _file_hash(path: Path) -> str:
    """Quick hash of file size + mtime for change detection."""
    try:
        stat = path.stat()
        return f"{stat.st_size}:{stat.st_mtime}"
    except OSError:
        return ""


def main(args: list[str] | None = None) -> None:
    """CLI entry point — launch uvicorn and open browser."""
    import uvicorn

    if args is None:
        args = sys.argv[1:]

    port = 8420
    host = "127.0.0.1"
    no_browser = False

    i = 0
    while i < len(args):
        if args[i] == "--port" and i + 1 < len(args):
            port = int(args[i + 1])
            i += 2
        elif args[i] == "--host" and i + 1 < len(args):
            host = args[i + 1]
            i += 2
        elif args[i] == "--no-browser":
            no_browser = True
            i += 1
        elif args[i] in ("-h", "--help"):
            print("Usage: agent-replay [OPTIONS]")
            print("\nLaunch the agent-replay web dashboard.")
            print("\nOptions:")
            print(f"  --port PORT      Port to listen on (default: {port})")
            print(f"  --host HOST      Host to bind to (default: {host})")
            print("  --no-browser     Don't auto-open browser")
            sys.exit(0)
        else:
            i += 1

    url = f"http://{host}:{port}"
    print(f"agent-replay v0.2.0 — starting at {url}")

    if not no_browser:
        # Open browser after a short delay to let server start
        import threading
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()

    uvicorn.run(app, host=host, port=port, log_level="warning")
