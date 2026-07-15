import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAgentChat } from "./useAgentChat.js";
import { startRecording } from "./wav.js";
import Markdown from "./Markdown.jsx";
import { t } from "../i18n.js";

function MicButton({ onText }) {
  const [state, setState] = useState("idle"); // idle | rec | busy
  const recRef = useRef(null);

  const toggle = async () => {
    if (state === "busy") return;
    if (state === "rec") {
      setState("busy");
      try {
        const wav = await recRef.current.stop();
        const fd = new FormData();
        fd.append("audio", wav, "rec.wav");
        const r = await fetch("/agent/asr", { method: "POST", body: fd });
        if (!r.ok) throw new Error("asr failed");
        const data = await r.json();
        const text =
          data.text ?? data.transcription ?? data.result ??
          (Array.isArray(data.segments) ? data.segments.map((s) => s.text).join(" ") : "");
        if (text) onText(String(text).trim());
      } catch {
        onText("");
      } finally {
        recRef.current = null;
        setState("idle");
      }
      return;
    }
    try {
      recRef.current = await startRecording();
      setState("rec");
    } catch {
      setState("idle");
    }
  };

  useEffect(() => () => recRef.current?.cancel?.(), []);

  return (
    <button
      type="button"
      className={`agent-mic${state === "rec" ? " is-rec" : ""}`}
      title={state === "rec" ? t("mic_stop") : t("mic_start")}
      disabled={state === "busy"}
      onClick={toggle}
    >
      {state === "busy" ? (
        <span className="agent-mic-busy" />
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      )}
    </button>
  );
}

export default function AgentChat({ boardId, token, api, onClose, asrEnabled }) {
  const apiRef = useRef(api);
  apiRef.current = api;
  const { messages, streaming, busy, send, clear } = useAgentChat({ boardId, token, apiRef });
  const [input, setInput] = useState("");
  const logRef = useRef(null);
  const taRef = useRef(null);
  const paneRef = useRef(null);

  // Мобильная клавиатура: приподнимаем шторку на высоту клавиатуры (visualViewport).
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const upd = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      paneRef.current?.style.setProperty("--kb", kb + "px");
    };
    vv.addEventListener("resize", upd);
    vv.addEventListener("scroll", upd);
    upd();
    return () => {
      vv.removeEventListener("resize", upd);
      vv.removeEventListener("scroll", upd);
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    const h = Math.min(el.scrollHeight + 2, 140); // +2 — рамки при border-box
    el.style.height = h + "px";
    el.style.overflowY = el.scrollHeight + 2 > 140 ? "auto" : "hidden";
  }, [input]);

  const submit = () => {
    const t = input.trim();
    if (!t || busy) return;
    send(t);
    setInput("");
  };

  const empty = messages.length === 0 && !streaming;

  return (
    <aside className="agent-pane" ref={paneRef} onClick={(e) => e.stopPropagation()}>
      <header className="agent-head">
        <span className="agent-title">{t("agent_title")}</span>
        <span className="agent-head-actions">
          <button className="agent-clear" title={t("agent_clear_title")} onClick={clear}>
            {t("agent_clear")}
          </button>
          <button className="agent-close" title={t("agent_close_title")} onClick={onClose}>
            ×
          </button>
        </span>
      </header>

      <div className="agent-log" ref={logRef}>
        {empty && <div className="agent-empty">{t("agent_empty")}</div>}
        {messages.map((m) => (
          <Bubble key={m.id} m={m} />
        ))}
        {streaming && <Bubble m={{ role: "assistant", ...streaming }} live />}
      </div>

      <footer className="agent-foot">
        <textarea
          ref={taRef}
          rows={1}
          placeholder={t("agent_placeholder")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {asrEnabled && (
          <MicButton onText={(t) => t && setInput((v) => (v ? v.trimEnd() + " " + t : t))} />
        )}
        <button className="agent-send" type="button" disabled={busy || !input.trim()} onClick={submit} title={t("agent_send")}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </footer>
    </aside>
  );
}

function Bubble({ m, live }) {
  return (
    <div className={`agent-msg is-${m.role}${live ? " is-live" : ""}`}>
      {m.tools?.length > 0 && (
        <div className="agent-tools">
          {m.tools.map((t, i) => (
            <span key={i}>✎ {t}</span>
          ))}
        </div>
      )}
      {m.text &&
        (m.role === "assistant" ? (
          <div className="agent-text"><Markdown text={m.text} /></div>
        ) : (
          <div className="agent-text is-plain">{m.text}</div>
        ))}
      {live && !m.text && (
        <div className="agent-dots">
          <span />
          <span />
          <span />
        </div>
      )}
    </div>
  );
}
