"""Boards agent sidecar. Internal-only: reachable через прокси server.js,
который уже проверил права на доску (uid/token) до апгрейда."""

import asyncio
import json
import logging
import os

import httpx
from fastapi import FastAPI, HTTPException, UploadFile, WebSocket, WebSocketDisconnect

from . import agent, board_tools, config, sessions

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("boards.main")

os.makedirs(config.SESSIONS_DIR, exist_ok=True)  # и DATA_DIR — он же cwd агента

app = FastAPI()


@app.get("/health")
async def health():
    return {"ok": True, "asr": bool(config.ASR_UPSTREAM), "model": config.CLAUDE_MODEL}


@app.post("/asr/transcribe")
async def transcribe(audio: UploadFile):
    if not config.ASR_UPSTREAM:
        raise HTTPException(503, "Распознавание речи не настроено")
    content = await audio.read()
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            config.ASR_UPSTREAM,
            files={"audio": (audio.filename or "rec.wav", content, audio.content_type or "audio/wav")},
        )
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, "Ошибка распознавания речи")
    return resp.json()


def _context_prefix(context: dict) -> str:
    sel = (context or {}).get("selection") or []
    if not sel:
        return ""
    return f"[Контекст: пользователь выделил на доске элементы: {', '.join(str(s) for s in sel[:40])}]\n"


@app.websocket("/chat/ws")
async def chat_ws(ws: WebSocket, board: str = "", uid: str = "", lang: str = "ru"):
    if not sessions.BOARD_RE.match(board):
        await ws.close(code=4001)
        return
    busy_msg = (
        "Подождите, я ещё думаю над прошлым сообщением." if lang == "ru"
        else "Hang on — still working on the previous message."
    )
    await ws.accept()
    logger.info("chat ws connected (board %s)", board[:8])

    send_lock = asyncio.Lock()  # turn stream and cmd frames share the socket

    async def emit(payload: dict) -> None:
        async with send_lock:
            await ws.send_json(payload)

    executor = board_tools.BrowserExecutor(emit)
    turn: asyncio.Task | None = None

    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue
            mtype = data.get("type")

            if mtype == "cmd_result":
                executor.resolve(str(data.get("id")), data.get("result") or {"ok": False, "error": "пустой ответ"})

            elif mtype == "clear":
                sessions.clear(board)
                await emit({"t": "cleared"})

            elif mtype == "message":
                text = (data.get("text") or "").strip()
                if not text:
                    continue
                if turn and not turn.done():
                    await emit({"t": "error", "text": busy_msg})
                    continue
                prompt = _context_prefix(data.get("context") or {}) + text
                turn = asyncio.create_task(agent.run_turn(emit, executor, board, prompt, lang))

    except WebSocketDisconnect:
        logger.info("chat ws disconnected (board %s)", board[:8])
    finally:
        executor.close()
        if turn and not turn.done():
            turn.cancel()
