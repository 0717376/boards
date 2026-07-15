"""Claude Agent SDK engine — one session per board, streamed over the chat WS.

Adapted from Bender's agent.py: same streaming/stale-session mechanics, but the
only tools are mcp__board__* relayed to the browser via a contextvar-bound
BrowserExecutor, and sessions are keyed by board id.
"""

import logging
import time
from collections.abc import Awaitable, Callable

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ResultMessage,
    StreamEvent,
    TextBlock,
    ToolUseBlock,
    query,
)

from . import board_tools, clock, config, sessions

logger = logging.getLogger("boards.agent")

Emit = Callable[[dict], Awaitable[None]]

EXPIRED_NOTE = (
    "[Прошлая сессия закрыта по неактивности — это начало нового разговора; "
    "историю прошлых бесед не выдумывай.]\n"
)


def build_options(resume: str | None) -> ClaudeAgentOptions:
    return ClaudeAgentOptions(
        model=config.CLAUDE_MODEL,
        system_prompt=config.SYSTEM_PROMPT,
        allowed_tools=board_tools.TOOL_NAMES,
        disallowed_tools=["Bash", "Read", "Write", "Edit", "MultiEdit", "NotebookEdit",
                          "Glob", "Grep", "WebSearch", "WebFetch", "Task", "TodoWrite"],
        mcp_servers={"board": board_tools.server},
        include_partial_messages=True,
        resume=resume,
        cwd=config.DATA_DIR,
        setting_sources=None,
    )


def _error_text(m: ResultMessage, lang: str = "ru") -> str:
    blob = " ".join(str(x) for x in (m.result, getattr(m, "errors", None), getattr(m, "api_error_status", None)) if x).lower()
    if "context" in blob or "too long" in blob or "max tokens" in blob:
        return ("Контекст разговора переполнен — нажмите «очистить» и начните заново." if lang == "ru"
                else "The conversation context is full — press “clear” and start over.")
    return "Ошибка Claude. Попробуйте очистить контекст." if lang == "ru" else "Claude error. Try clearing the context."


class _StaleSession(Exception):
    pass


def _is_stale(exc: Exception) -> bool:
    return "No conversation found with session" in str(exc)


async def run_turn(emit: Emit, executor: board_tools.BrowserExecutor,
                   board_id: str, message: str, lang: str = "ru") -> None:
    """One chat turn for one board. Serialized per board by sessions.lock_for."""
    async with sessions.lock_for(board_id):
        # Системный промпт русский — при английском интерфейсе напоминаем про язык явно.
        lang_note = (
            "[UI language: English — reply AND label everything you draw in English, "
            "unless the user writes in another language.]\n"
            if lang == "en" else ""
        )
        message = f"{clock.stamp(lang)}\n{lang_note}{message}"
        token = board_tools.current_executor.set(executor)
        try:
            await _run(emit, board_id, message, lang)
        except _StaleSession:
            logger.warning("stale session for board %s; retrying fresh", board_id[:8])
            sessions.clear(board_id)
            await _run(emit, board_id, message, lang)
        finally:
            board_tools.current_executor.reset(token)


async def _run(emit: Emit, board_id: str, message: str, lang: str = "ru") -> None:
    sid, expired = sessions.load(board_id)
    if expired:
        message = EXPIRED_NOTE + message
    streaming_text = ""
    current_msg_id = ""
    last_push = 0.0
    THROTTLE = 0.05
    final_sid = sid
    produced = False

    async def _emit(ev: dict) -> None:
        nonlocal produced
        if ev.get("t") in ("text", "tool"):
            produced = True
        await emit(ev)

    try:
        async for m in query(prompt=message, options=build_options(sid)):
            if isinstance(m, StreamEvent):
                ev = m.event
                itype = ev.get("type", "")
                if itype == "message_start":
                    streaming_text = ""
                    current_msg_id = ev.get("message", {}).get("id", current_msg_id)
                elif itype == "content_block_delta":
                    delta = ev.get("delta", {})
                    if delta.get("type") == "text_delta" and delta.get("text"):
                        streaming_text += delta["text"]
                        now = time.monotonic()
                        if now - last_push >= THROTTLE:
                            await _emit({"t": "text", "id": current_msg_id, "text": streaming_text})
                            last_push = now
                elif itype == "content_block_stop" and streaming_text:
                    await _emit({"t": "text", "id": current_msg_id, "text": streaming_text})
                    last_push = time.monotonic()

            elif isinstance(m, AssistantMessage):
                current_msg_id = m.message_id or current_msg_id
                for block in m.content:
                    if isinstance(block, TextBlock) and block.text:
                        await _emit({"t": "text", "id": current_msg_id, "text": block.text})
                    elif isinstance(block, ToolUseBlock):
                        await _emit({"t": "tool", "name": (block.name or "").replace("mcp__board__", "")})
                streaming_text = ""

            elif isinstance(m, ResultMessage):
                final_sid = m.session_id or sid
                if m.is_error:
                    await emit({"t": "error", "text": _error_text(m, lang)})

        sessions.save(board_id, final_sid)
        await emit({"t": "done"})

    except Exception as e:  # noqa: BLE001 — surface engine failures to the client
        if _is_stale(e) and not produced:
            raise _StaleSession from e
        logger.exception("run_turn failed (board %s)", board_id[:8])
        await emit({"t": "error", "text": str(e)})
        await emit({"t": "done"})
