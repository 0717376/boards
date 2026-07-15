"""Board tools exposed to Claude as mcp__board__*.

Unlike a classic MCP server, these tools don't touch storage: each call is
relayed over the chat WebSocket to the user's browser, executed there against
the live excalidrawAPI, and the browser's reply becomes the tool result.
The current turn's relay is carried in a contextvar (set in agent.run_turn
before query(); SDK-internal tasks inherit the context snapshot).
"""

import asyncio
import contextvars
import json

from claude_agent_sdk import create_sdk_mcp_server, tool

CMD_TIMEOUT = 60.0

current_executor: contextvars.ContextVar["BrowserExecutor | None"] = contextvars.ContextVar(
    "board_executor", default=None
)


class BrowserExecutor:
    """One per chat WebSocket connection: sends {"t":"cmd"} frames to the
    browser and resolves futures from its cmd_result replies."""

    def __init__(self, send_json):
        self._send = send_json
        self._pending: dict[str, asyncio.Future] = {}
        self._n = 0

    async def call(self, name: str, args: dict) -> dict:
        self._n += 1
        cid = f"c{self._n}"
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[cid] = fut
        try:
            await self._send({"t": "cmd", "id": cid, "name": name, "args": args})
            return await asyncio.wait_for(fut, CMD_TIMEOUT)
        except TimeoutError:
            return {"ok": False, "error": "браузер не ответил (таймаут)"}
        finally:
            self._pending.pop(cid, None)

    def resolve(self, cid: str, result: dict) -> None:
        fut = self._pending.get(cid)
        if fut and not fut.done():
            fut.set_result(result)

    def close(self) -> None:
        for fut in self._pending.values():
            if not fut.done():
                fut.set_result({"ok": False, "error": "доска отключилась"})


def _text(obj) -> dict:
    return {"content": [{"type": "text", "text": json.dumps(obj, ensure_ascii=False, default=str)}]}


async def _relay(name: str, args: dict) -> dict:
    ex = current_executor.get()
    if ex is None:
        return _text({"ok": False, "error": "нет связи с открытой доской"})
    return _text(await ex.call(name, args))


@tool(
    "get_scene",
    "Компактная выжимка сцены доски: элементы (id, тип, координаты, размеры, текст, цвета, "
    "связи стрелок), выделение пользователя, видимая область. Вызывай первым.",
    {"type": "object", "properties": {}},
)
async def get_scene(args):
    return await _relay("get_scene", args)


@tool(
    "add_mermaid",
    "Нарисовать диаграмму из Mermaid-кода (flowchart/graph, sequenceDiagram, classDiagram). "
    "x,y (опционально) — куда положить левый верхний угол; без них — на свободное место.",
    {
        "type": "object",
        "properties": {
            "mermaid": {"type": "string"},
            "x": {"type": "number"},
            "y": {"type": "number"},
        },
        "required": ["mermaid"],
    },
)
async def add_mermaid(args):
    return await _relay("add_mermaid", args)


@tool(
    "add_elements",
    "Добавить элементы-скелеты на доску. elements — массив объектов "
    "(rectangle/ellipse/diamond/text/arrow/line, см. системный промпт).",
    {
        "type": "object",
        "properties": {"elements": {"type": "array", "items": {"type": "object"}}},
        "required": ["elements"],
    },
)
async def add_elements(args):
    return await _relay("add_elements", args)


@tool(
    "update_elements",
    "Изменить существующие элементы. updates — массив {id, ...новые свойства}: x, y, width, "
    "height, angle, text, fontSize, strokeColor, backgroundColor, fillStyle, strokeWidth, "
    "strokeStyle, opacity, roughness.",
    {
        "type": "object",
        "properties": {"updates": {"type": "array", "items": {"type": "object"}}},
        "required": ["updates"],
    },
)
async def update_elements(args):
    return await _relay("update_elements", args)


@tool(
    "delete_elements",
    "Удалить элементы по id.",
    {
        "type": "object",
        "properties": {"ids": {"type": "array", "items": {"type": "string"}}},
        "required": ["ids"],
    },
)
async def delete_elements(args):
    return await _relay("delete_elements", args)


@tool(
    "zoom_to",
    "Навести камеру пользователя на элементы (ids; пустой список — вся доска).",
    {
        "type": "object",
        "properties": {"ids": {"type": "array", "items": {"type": "string"}}},
    },
)
async def zoom_to(args):
    return await _relay("zoom_to", args)


TOOLS = [get_scene, add_mermaid, add_elements, update_elements, delete_elements, zoom_to]
TOOL_NAMES = [f"mcp__board__{t.name}" for t in TOOLS]
server = create_sdk_mcp_server("board", version="1.0.0", tools=TOOLS)
