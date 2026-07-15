import { useCallback, useEffect, useRef, useState } from "react";
import { executeCommand } from "./commands.js";

const TOOL_LABELS = {
  get_scene: "смотрю на доску",
  add_mermaid: "рисую схему",
  add_elements: "добавляю элементы",
  update_elements: "правлю элементы",
  delete_elements: "удаляю элементы",
  zoom_to: "показываю результат",
};

export function useAgentChat({ boardId, token, apiRef }) {
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(null); // {id, text, tools[]}
  const [busy, setBusy] = useState(false);
  const wsRef = useRef(null);
  const streamRef = useRef(null);

  const connect = useCallback(() => {
    return new Promise((resolve, reject) => {
      const existing = wsRef.current;
      if (existing && existing.readyState === WebSocket.OPEN) return resolve(existing);
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/agent/chat?board=${boardId}&token=${token || ""}`);
      wsRef.current = ws;
      ws.onopen = () => resolve(ws);
      ws.onerror = () => reject(new Error("ws error"));
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.t === "text") {
          const s = streamRef.current ?? { id: m.id, text: "", tools: [] };
          s.id = m.id || s.id;
          s.text = m.text;
          streamRef.current = { ...s };
          setStreaming(streamRef.current);
        } else if (m.t === "tool") {
          const s = streamRef.current ?? { id: "t", text: "", tools: [] };
          const label = TOOL_LABELS[m.name] || m.name;
          if (s.tools.at(-1) !== label) s.tools = [...s.tools, label];
          streamRef.current = { ...s };
          setStreaming(streamRef.current);
        } else if (m.t === "cmd") {
          (async () => {
            let result;
            try {
              result = await executeCommand(apiRef.current, m.name, m.args || {});
            } catch (e) {
              result = { ok: false, error: String(e?.message || e) };
            }
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "cmd_result", id: m.id, result }));
            }
          })();
        } else if (m.t === "error") {
          const s = streamRef.current ?? { id: "e", text: "", tools: [] };
          s.text = (s.text ? s.text + "\n\n" : "") + "⚠ " + m.text;
          streamRef.current = { ...s };
          setStreaming(streamRef.current);
        } else if (m.t === "cleared") {
          streamRef.current = null;
          setStreaming(null);
          setMessages([]);
          setBusy(false);
        } else if (m.t === "done") {
          const s = streamRef.current;
          if (s && (s.text || s.tools.length)) {
            setMessages((prev) => [...prev, { id: s.id || crypto.randomUUID(), role: "assistant", text: s.text, tools: s.tools }]);
          }
          streamRef.current = null;
          setStreaming(null);
          setBusy(false);
        }
      };
      ws.onclose = () => {
        wsRef.current = null;
        const s = streamRef.current;
        if (s) {
          s.text = (s.text ? s.text + "\n\n" : "") + "⚠ Связь с ассистентом оборвалась.";
          setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", text: s.text, tools: s.tools }]);
          streamRef.current = null;
          setStreaming(null);
        }
        setBusy(false);
      };
    });
  }, [boardId, token, apiRef]);

  const send = useCallback(
    async (text) => {
      const t = text.trim();
      if (!t) return;
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text: t }]);
      setBusy(true);
      streamRef.current = { id: "", text: "", tools: [] };
      setStreaming(streamRef.current);
      const st = apiRef.current?.getAppState?.();
      const selection = st
        ? Object.keys(st.selectedElementIds || {}).filter((k) => st.selectedElementIds[k])
        : [];
      try {
        const ws = await connect();
        ws.send(JSON.stringify({ type: "message", text: t, context: { selection } }));
      } catch {
        streamRef.current = null;
        setStreaming(null);
        setBusy(false);
        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", text: "Не получилось связаться с ассистентом. Попробуйте ещё раз." }]);
      }
    },
    [connect, apiRef]
  );

  const clear = useCallback(async () => {
    try {
      const ws = await connect();
      ws.send(JSON.stringify({ type: "clear" }));
    } catch {
      setMessages([]);
      setStreaming(null);
    }
  }, [connect]);

  useEffect(() => () => wsRef.current?.close(), []);

  return { messages, streaming, busy, send, clear };
}
