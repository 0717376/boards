"""Per-board Claude session persistence: data/sessions/<boardId>.json."""

import asyncio
import json
import os
import re
from datetime import datetime, timedelta

from . import config

BOARD_RE = re.compile(r"^[0-9a-f-]{36}$")

_locks: dict[str, asyncio.Lock] = {}


def lock_for(board_id: str) -> asyncio.Lock:
    return _locks.setdefault(board_id, asyncio.Lock())


def _path(board_id: str) -> str:
    return os.path.join(config.SESSIONS_DIR, f"{board_id}.json")


def load(board_id: str) -> tuple[str | None, bool]:
    """(session_id, expired) — expired=True when the freshness window lapsed."""
    try:
        with open(_path(board_id)) as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None, False
    sid = data.get("session_id")
    last = data.get("last_used")
    if sid and last and config.SESSION_FRESH_HOURS > 0:
        try:
            if datetime.now() - datetime.fromisoformat(last) > timedelta(hours=config.SESSION_FRESH_HOURS):
                clear(board_id)
                return None, True
        except ValueError:
            pass
    return sid, False


def save(board_id: str, session_id: str | None) -> None:
    if not session_id:
        return
    os.makedirs(config.SESSIONS_DIR, exist_ok=True)
    with open(_path(board_id), "w") as f:
        json.dump({"session_id": session_id, "last_used": datetime.now().isoformat(timespec="seconds")}, f)


def clear(board_id: str) -> None:
    try:
        os.remove(_path(board_id))
    except FileNotFoundError:
        pass
