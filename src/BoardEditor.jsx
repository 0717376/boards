import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Excalidraw,
  serializeAsJSON,
  getSceneVersion,
  reconcileElements,
  exportToCanvas,
  CaptureUpdateAction,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { getBoard, updateBoard, enableShare, disableShare, listVersions, getVersion, restoreVersion } from "./api.js";
import { getUserName, setUserName, getUserHue, hueId, avatarColor } from "./user.js";

const SAVE_DEBOUNCE_MS = 800;
const SYNC_THROTTLE_MS = 120;
const PTR_THROTTLE_MS = 30;
const VIEW_SEND_MS = 100;
const THUMB_INTERVAL_MS = 4000;
const VIEW_THROTTLE_MS = 500;

/**
 * Game-netcode style smoother: timestamped sample buffer replayed behind real time.
 * - adaptive jitter buffer: replay delay follows the measured arrival interval + jitter
 * - Catmull-Rom spline between samples: curved motion instead of polyline segments
 * - dead reckoning: on buffer underrun keeps moving by damped velocity instead of freezing
 * - output smoothing: an exponential layer on top absorbs extrapolation corrections
 */
class SmoothBuffer {
  constructor(keys, { baseDelay, maxDelay, maxExtrap, tau, eps }) {
    this.keys = keys;
    this.baseDelay = baseDelay;
    this.maxDelay = maxDelay;
    this.maxExtrap = maxExtrap;
    this.tau = tau;
    this.eps = eps;
    this.q = [];
    this.rendered = null;
    this.interval = 60;
    this.jitter = 0;
    this.lastArrival = 0;
    this.lastRead = 0;
  }

  push(sample) {
    const now = performance.now();
    if (this.lastArrival) {
      const d = Math.min(500, now - this.lastArrival);
      this.interval = this.interval * 0.8 + d * 0.2;
      this.jitter = this.jitter * 0.8 + Math.abs(d - this.interval) * 0.2;
    }
    this.lastArrival = now;
    this.q.push({ ...sample, t: now });
    if (this.q.length > 90) this.q.splice(0, this.q.length - 90);
  }

  delay() {
    return Math.min(this.maxDelay, Math.max(this.baseDelay, this.interval * 1.4 + this.jitter * 3));
  }

  static cr(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }

  read() {
    const q = this.q;
    if (!q.length) return null;
    const now = performance.now();
    const rt = now - this.delay();
    let i = 0;
    while (i < q.length - 1 && q[i + 1].t <= rt) i++;
    if (i > 1) {
      q.splice(0, i - 1); // keep one point behind the playhead for the spline
      i = 1;
    }
    const p1 = q[i];
    const p2 = q[i + 1];
    const target = {};
    if (p2 && p1.t <= rt) {
      const k = (rt - p1.t) / (p2.t - p1.t || 1);
      const p0 = q[i - 1] || p1;
      const p3 = q[i + 2] || p2;
      for (const key of this.keys) target[key] = SmoothBuffer.cr(p0[key], p1[key], p2[key], p3[key], k);
    } else if (!p2 && q.length >= 2 && rt > p1.t) {
      const prev = q[q.length - 2];
      const dt = p1.t - prev.t || 1;
      const dtx = Math.min(this.maxExtrap, rt - p1.t);
      const damp = Math.max(0, 1 - dtx / (this.maxExtrap * 1.5));
      for (const key of this.keys) target[key] = p1[key] + ((p1[key] - prev[key]) / dt) * dtx * damp;
    } else {
      for (const key of this.keys) target[key] = p1[key];
    }

    const dtr = Math.min(100, now - (this.lastRead || now));
    this.lastRead = now;
    const a = 1 - Math.exp(-dtr / this.tau);
    if (!this.rendered) this.rendered = { ...target };
    let converged = true;
    for (const key of this.keys) {
      this.rendered[key] += (target[key] - this.rendered[key]) * a;
      if (Math.abs(target[key] - this.rendered[key]) > this.eps[key]) converged = false;
    }
    const idle = q.length === 1 && now - p1.t > this.delay() + this.maxExtrap * 2;
    const settled = idle && converged;
    if (settled) for (const key of this.keys) this.rendered[key] = target[key];
    return { values: this.rendered, settled };
  }
}

// viewport (scroll/zoom) is per-browser: collaborators each keep their own
const viewKey = (id) => `boards.view.${id}`;

function loadViewport(id) {
  try {
    const v = JSON.parse(localStorage.getItem(viewKey(id)));
    if (v && Number.isFinite(v.scrollX) && Number.isFinite(v.scrollY) && v.zoom > 0) {
      return { scrollX: v.scrollX, scrollY: v.scrollY, zoom: { value: v.zoom } };
    }
  } catch {}
  return null;
}

const fmtVersion = (iso) =>
  new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

const ClockIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
  </svg>
);

function throttle(fn, ms) {
  let timer = null;
  let queued = false;
  const wrapped = (...args) => {
    if (timer) {
      queued = true;
      wrapped.lastArgs = args;
      return;
    }
    fn(...args);
    timer = setTimeout(() => {
      timer = null;
      if (queued) {
        queued = false;
        wrapped(...(wrapped.lastArgs || []));
      }
    }, ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

export default function BoardEditor({ id, token }) {
  const [board, setBoard] = useState(null);
  const [error, setError] = useState(null);
  const [api, setApi] = useState(null);
  const [status, setStatus] = useState("saved"); // saved | saving | error
  const [peers, setPeers] = useState([]);
  const [wsOpen, setWsOpen] = useState(false);
  const [followPid, setFollowPid] = useState(null);
  const [editingName, setEditingName] = useState(false);
  const [sharePop, setSharePop] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [versions, setVersions] = useState(null);
  const [preview, setPreview] = useState(null); // {vid, at, img|null}
  const [restoring, setRestoring] = useState(false);
  const [tokens, setTokens] = useState({ edit: null, view: null });
  const [userName, setName] = useState(getUserName);

  const wsRef = useRef(null);
  const lastVersion = useRef(-1);
  const lastThumbVersion = useRef(-1);
  const sentVersions = useRef(new Map());
  const sentFiles = useRef(new Set());
  const collaborators = useRef(new Map());
  const cursorTargets = useRef(new Map());
  const cursorRaf = useRef(0);
  const followRef = useRef(null);
  const latestViews = useRef(new Map());
  const lastViewKey = useRef(null);
  const canvasRef = useRef(null);
  const viewQueue = useRef(null); // SmoothBuffer while following
  const viewRaf = useRef(0);
  const saveTimer = useRef(null);
  const pendingScene = useRef(null);
  const mounted = useRef(true);

  /* ---------- load ---------- */
  useEffect(() => {
    mounted.current = true;
    getBoard(id, token)
      .then((b) => {
        lastVersion.current = getSceneVersion(b.scene?.elements || []);
        lastThumbVersion.current = lastVersion.current;
        setTokens({ edit: b.shareToken || null, view: b.viewToken || null });
        setBoard(b);
      })
      .catch((e) => setError(e.message));
    return () => {
      mounted.current = false;
      clearTimeout(saveTimer.current);
      wsRef.current?.close(1000);
    };
  }, [id, token]);

  const isOwner = board?.role === "owner";
  const isViewer = board?.role === "viewer";

  /* ---------- REST autosave (fallback when no live connection) ---------- */
  const flushScene = useCallback(async () => {
    if (!pendingScene.current) return;
    const scene = pendingScene.current;
    pendingScene.current = null;
    setStatus("saving");
    try {
      await updateBoard(id, { scene }, token);
      if (mounted.current) setStatus("saved");
    } catch {
      if (mounted.current) setStatus("error");
    }
  }, [id, token]);

  /* ---------- follow mode ---------- */
  const applyView = useCallback(
    (v) => {
      if (!api) return;
      const my = api.getAppState();
      // show the same scene rect: match center, scale zoom by canvas size ratio
      const scale = Math.min(my.width / v.w, my.height / v.h) || 1;
      const z = Math.min(30, Math.max(0.05, v.z * scale));
      const cx = v.w / (2 * v.z) - v.sx;
      const cy = v.h / (2 * v.z) - v.sy;
      api.updateScene({
        appState: { scrollX: my.width / (2 * z) - cx, scrollY: my.height / (2 * z) - cy, zoom: { value: z } },
      });
    },
    [api]
  );

  useEffect(() => {
    followRef.current = followPid;
    if (!followPid) {
      cancelAnimationFrame(viewRaf.current);
      viewRaf.current = 0;
      viewQueue.current = null;
    }
  }, [followPid]);

  // the followed camera runs through the same smoother as cursors; the scene center is
  // interpolated in scene space and the zoom logarithmically (multiplicative quantity)
  const startViewLoop = useCallback(() => {
    if (viewRaf.current || !api) return;
    const step = () => {
      viewRaf.current = 0;
      const buf = viewQueue.current;
      if (!followRef.current || !buf) return;
      const r = buf.read();
      if (!r) return;
      const { cx, cy, lz } = r.values;
      const { w, h } = buf.wh || { w: 1, h: 1 };
      const my = api.getAppState();
      const scale = Math.min(my.width / w, my.height / h) || 1;
      const z = Math.min(30, Math.max(0.05, Math.exp(lz) * scale));
      api.updateScene({
        appState: { scrollX: my.width / (2 * z) - cx, scrollY: my.height / (2 * z) - cy, zoom: { value: z } },
      });
      if (!r.settled) viewRaf.current = requestAnimationFrame(step);
    };
    viewRaf.current = requestAnimationFrame(step);
  }, [api]);

  const pushView = useCallback(
    (v) => {
      let buf = viewQueue.current;
      if (!buf) {
        buf = new SmoothBuffer(["cx", "cy", "lz"], {
          baseDelay: 140,
          maxDelay: 350,
          maxExtrap: 80,
          tau: 60,
          eps: { cx: 0.5, cy: 0.5, lz: 0.002 },
        });
        viewQueue.current = buf;
      }
      buf.wh = { w: v.w, h: v.h };
      buf.push({ cx: v.w / (2 * v.z) - v.sx, cy: v.h / (2 * v.z) - v.sy, lz: Math.log(v.z) });
      startViewLoop();
    },
    [startViewLoop]
  );

  const toggleFollow = (pid) => {
    setFollowPid((cur) => {
      const next = cur === pid ? null : pid;
      if (next) {
        viewQueue.current = null; // fresh smoother per follow session
        const v = latestViews.current.get(pid);
        if (v) applyView(v); // jump to where they are, then interpolate from there
      }
      return next;
    });
  };

  // any own interaction with the canvas (or Esc) breaks out of follow mode
  useEffect(() => {
    if (!followPid) return;
    const el = canvasRef.current;
    const stop = () => setFollowPid(null);
    const onKey = (e) => e.key === "Escape" && stop();
    el?.addEventListener("wheel", stop, { capture: true, passive: true });
    el?.addEventListener("pointerdown", stop, true);
    window.addEventListener("keydown", onKey);
    return () => {
      el?.removeEventListener("wheel", stop, { capture: true });
      el?.removeEventListener("pointerdown", stop, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [followPid]);

  /* ---------- live sync ---------- */
  const syncElements = useRef(null);
  const syncPointer = useRef(null);
  const syncView = useRef(null);

  useEffect(() => {
    if (!api || !board) return;

    syncElements.current = throttle(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== 1) return;
      const els = api.getSceneElementsIncludingDeleted();
      const changed = els.filter((e) => sentVersions.current.get(e.id) !== e.version);
      if (changed.length) {
        for (const e of changed) sentVersions.current.set(e.id, e.version);
        ws.send(JSON.stringify({ t: "el", els: changed }));
      }
      const files = api.getFiles();
      const newFiles = {};
      let hasNew = false;
      for (const [fid, f] of Object.entries(files)) {
        if (!sentFiles.current.has(fid)) {
          sentFiles.current.add(fid);
          newFiles[fid] = f;
          hasNew = true;
        }
      }
      if (hasNew) ws.send(JSON.stringify({ t: "files", files: newFiles }));
    }, SYNC_THROTTLE_MS);

    syncView.current = throttle(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== 1) return;
      const s = api.getAppState();
      const key = `${s.scrollX.toFixed(1)}|${s.scrollY.toFixed(1)}|${s.zoom.value.toFixed(4)}`;
      if (key === lastViewKey.current) return;
      lastViewKey.current = key;
      ws.send(JSON.stringify({ t: "view", sx: s.scrollX, sy: s.scrollY, z: s.zoom.value, w: s.width, h: s.height }));
    }, VIEW_SEND_MS);

    syncPointer.current = throttle((x, y, button) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== 1) return;
      const sel = Object.keys(api.getAppState().selectedElementIds || {});
      ws.send(JSON.stringify({ t: "ptr", x, y, sel, btn: button === "down" ? "down" : "up" }));
    }, PTR_THROTTLE_MS);

    let retryTimer = null;
    let closedByUs = false;

    const applyRemote = (els) => {
      for (const e of els) sentVersions.current.set(e.id, e.version);
      const merged = reconcileElements(api.getSceneElementsIncludingDeleted(), els, api.getAppState());
      lastVersion.current = getSceneVersion(merged);
      api.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });
    };

    const renderCollaborators = throttle(() => {
      api.updateScene({ collaborators: new Map(collaborators.current) });
    }, 50);

    const startCursorLoop = () => {
      if (cursorRaf.current) return;
      const step = () => {
        cursorRaf.current = 0;
        let pending = false;
        for (const [pid, buf] of cursorTargets.current) {
          const c = collaborators.current.get(pid);
          if (!c) {
            cursorTargets.current.delete(pid);
            continue;
          }
          const r = buf.read();
          if (!r) continue;
          c.pointer = { x: r.values.x, y: r.values.y, tool: "pointer" };
          if (!r.settled) pending = true;
        }
        api.updateScene({ collaborators: new Map(collaborators.current) });
        if (pending) cursorRaf.current = requestAnimationFrame(step);
      };
      cursorRaf.current = requestAnimationFrame(step);
    };

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws?board=${id}&token=${token || ""}`);
      wsRef.current = ws;

      ws.onopen = () => {
        const hue = getUserHue();
        ws.send(JSON.stringify({ t: "join", name: getUserName(), color: avatarColor(hue), hid: hueId(hue) }));
        setWsOpen(true);
        lastViewKey.current = null;
        syncView.current?.(); // let late joiners know where we are right away
      };

      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        switch (msg.t) {
          case "init": {
            ws.pid = msg.pid;
            if (msg.els?.length) applyRemote(msg.els);
            for (const fid of Object.keys(msg.files || {})) sentFiles.current.add(fid);
            const fl = Object.values(msg.files || {});
            if (fl.length) api.addFiles(fl);
            setPeers(msg.peers.filter((p) => p.pid !== msg.pid));
            break;
          }
          case "el":
            applyRemote(msg.els || []);
            break;
          case "files": {
            for (const fid of Object.keys(msg.files || {})) sentFiles.current.add(fid);
            api.addFiles(Object.values(msg.files || {}));
            break;
          }
          case "ptr": {
            const prev = collaborators.current.get(msg.pid);
            collaborators.current.set(msg.pid, {
              id: msg.hid || msg.pid,
              username: msg.name,
              color: { background: msg.color, stroke: msg.color },
              // keep the on-screen position; the animation loop chases the fresh target
              pointer: prev?.pointer || { x: msg.x, y: msg.y, tool: "pointer" },
              selectedElementIds: Object.fromEntries((msg.sel || []).map((s) => [s, true])),
              button: msg.btn === "down" ? "down" : "up",
            });
            let buf = cursorTargets.current.get(msg.pid);
            if (!buf) {
              buf = new SmoothBuffer(["x", "y"], {
                baseDelay: 70,
                maxDelay: 220,
                maxExtrap: 90,
                tau: 30,
                eps: { x: 0.3, y: 0.3 },
              });
              cursorTargets.current.set(msg.pid, buf);
            }
            buf.push({ x: msg.x, y: msg.y });
            startCursorLoop();
            break;
          }
          case "view": {
            latestViews.current.set(msg.pid, msg);
            if (followRef.current === msg.pid) pushView(msg);
            break;
          }
          case "peers": {
            const alive = new Set(msg.peers.map((p) => p.pid));
            for (const pid of [...collaborators.current.keys()]) {
              if (!alive.has(pid)) {
                collaborators.current.delete(pid);
                cursorTargets.current.delete(pid);
                latestViews.current.delete(pid);
              }
            }
            if (followRef.current && !alive.has(followRef.current)) setFollowPid(null);
            renderCollaborators();
            setPeers(msg.peers.filter((p) => p.pid !== ws.pid));
            break;
          }
        }
      };

      ws.onclose = (ev) => {
        setWsOpen(false);
        setPeers([]);
        setFollowPid(null);
        collaborators.current.clear();
        if (api) api.updateScene({ collaborators: new Map() });
        if (closedByUs || !mounted.current) return;
        if (ev.code === 4003) {
          setError("Владелец закрыл доступ к доске");
          return;
        }
        if (ev.code === 4004) {
          location.hash = "#/";
          return;
        }
        if (ev.code === 4005) {
          // someone restored an older version — pick up the new state
          location.reload();
          return;
        }
        retryTimer = setTimeout(connect, 2000);
      };
    };

    connect();
    return () => {
      closedByUs = true;
      clearTimeout(retryTimer);
      cancelAnimationFrame(cursorRaf.current);
      cursorRaf.current = 0;
      syncElements.current?.cancel();
      syncPointer.current?.cancel();
      wsRef.current?.close(1000);
    };
  }, [api, board, id, token]);

  /* ---------- thumbnails ---------- */
  useEffect(() => {
    if (!api || isViewer) return;
    const gen = async () => {
      const els = api.getSceneElements();
      // scene may not be restored yet right after mount — never shoot a blank over a real drawing
      if (!els.length && board.scene?.elements?.length) return;
      lastThumbVersion.current = lastVersion.current;
      try {
        // raster snapshot: canvas renders with the real in-app fonts, unlike an <img>-embedded svg
        const canvas = await exportToCanvas({
          elements: els,
          appState: { ...api.getAppState(), exportBackground: true, viewBackgroundColor: "#ffffff" },
          files: api.getFiles(),
          exportPadding: 16,
          maxWidthOrHeight: 640,
        });
        let data = canvas.toDataURL("image/webp", 0.8);
        if (!data.startsWith("data:image/webp")) data = canvas.toDataURL("image/png");
        if (data.length <= 800 * 1024) await updateBoard(id, { thumb: data }, token);
      } catch {}
    };
    const tick = () => {
      if (lastVersion.current !== lastThumbVersion.current) gen();
    };
    const timer = setInterval(tick, THUMB_INTERVAL_MS);
    // don't lose the freshest state when the tab goes to background / closes
    const onVis = () => document.visibilityState === "hidden" && tick();
    document.addEventListener("visibilitychange", onVis);
    // a board with content but no stored thumb (drawn and closed quickly) heals on open,
    // waiting for the scene restore to actually land in the canvas first
    let healTimer = null;
    if (board.hasThumb === false && board.scene?.elements?.length) {
      let tries = 0;
      const heal = () => {
        if (api.getSceneElements().length) gen();
        else if (++tries < 20) healTimer = setTimeout(heal, 500);
      };
      heal();
    }
    return () => {
      clearInterval(timer);
      clearTimeout(healTimer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [api, id, token, isViewer]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- change handling ---------- */
  const saveViewport = useRef(
    throttle((appState) => {
      try {
        localStorage.setItem(
          viewKey(id),
          JSON.stringify({ scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: appState.zoom.value })
        );
      } catch {}
    }, VIEW_THROTTLE_MS)
  );

  const onChange = useCallback(
    (elements, appState, files) => {
      // pan/zoom fires onChange without bumping the scene version — persist it before the guard
      saveViewport.current(appState);
      syncView.current?.();
      if (isViewer) return;
      const version = getSceneVersion(elements);
      if (version === lastVersion.current) return;
      lastVersion.current = version;

      if (wsRef.current?.readyState === 1) {
        syncElements.current?.();
        setStatus("saved");
      } else {
        pendingScene.current = JSON.parse(serializeAsJSON(elements, appState, files, "local"));
        setStatus("saving");
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(flushScene, SAVE_DEBOUNCE_MS);
      }
    },
    [flushScene, isViewer]
  );

  const onPointerUpdate = useCallback(({ pointer, button }) => {
    syncPointer.current?.(pointer.x, pointer.y, button);
  }, []);

  /* ---------- name / share ---------- */
  const commitName = async (name) => {
    setEditingName(false);
    const clean = name.trim();
    if (!clean || clean === board.name) return;
    setBoard((b) => ({ ...b, name: clean }));
    await updateBoard(id, { name: clean }, token).catch(() => {});
  };

  const onShare = async () => {
    setHistOpen(false);
    if (!tokens.edit || !tokens.view) {
      const { shareToken: e, viewToken: v } = await enableShare(id);
      setTokens({ edit: e, view: v });
    }
    setSharePop(true);
  };

  const onHistory = async () => {
    setSharePop(false);
    if (histOpen) {
      setHistOpen(false);
      return;
    }
    setHistOpen(true);
    setPreview(null);
    setVersions(await listVersions(id, token).catch(() => []));
  };

  const onPickVersion = async (v) => {
    setPreview({ vid: v.id, at: v.at, img: null });
    try {
      const full = await getVersion(id, v.id, token);
      const canvas = await exportToCanvas({
        elements: full.scene?.elements || [],
        appState: { ...full.scene?.appState, exportBackground: true, viewBackgroundColor: "#ffffff" },
        files: full.scene?.files || {},
        exportPadding: 12,
        maxWidthOrHeight: 480,
      });
      setPreview((p) => (p?.vid === v.id ? { ...p, img: canvas.toDataURL("image/png") } : p));
    } catch {
      setPreview((p) => (p?.vid === v.id ? { ...p, img: "error" } : p));
    }
  };

  const onRestoreVersion = async () => {
    if (!preview || restoring) return;
    setRestoring(true);
    try {
      await restoreVersion(id, preview.vid, token);
      location.reload();
    } catch {
      setRestoring(false);
    }
  };

  const linkFor = (t) => (t ? `${location.origin}${location.pathname}#/s/${id}/${t}` : "");

  const copy = (t) => navigator.clipboard?.writeText(linkFor(t)).catch(() => {});

  const revokeShare = async () => {
    await disableShare(id);
    setTokens({ edit: null, view: null });
    setSharePop(false);
  };

  const commitUserName = (name) => {
    const clean = name.trim().slice(0, 60);
    if (!clean) return;
    setUserName(clean);
    setName(clean);
    // re-announce with the new name
    const ws = wsRef.current;
    const hue = getUserHue();
    if (ws?.readyState === 1)
      ws.send(JSON.stringify({ t: "join", name: clean, color: avatarColor(hue), hid: hueId(hue) }));
  };

  /* ---------- render ---------- */
  if (error)
    return (
      <div className="editor-error">
        <h2>Не получилось открыть доску</h2>
        <p>{error}</p>
        <a href="#/">← К моим доскам</a>
      </div>
    );
  if (!board) return <div className="editor-error"><h2>Открываем доску…</h2></div>;

  const statusText = isViewer
    ? "режим просмотра"
    : wsOpen && peers.length > 0
    ? "синхронизация онлайн"
    : { saved: "сохранено", saving: "сохранение…", error: "не сохранилось — проверьте сеть" }[status];

  return (
    <div className="editor">
      <header className="editor-header">
        <a className="editor-back" href="#/" title="К моим доскам">←</a>

        {editingName && isOwner ? (
          <input
            className="editor-name-input"
            autoFocus
            defaultValue={board.name}
            onBlur={(e) => commitName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName(e.target.value);
              if (e.key === "Escape") setEditingName(false);
            }}
          />
        ) : (
          <span
            className={`editor-name${isOwner ? " editable" : ""}`}
            title={isOwner ? "Нажмите, чтобы переименовать" : board.name}
            onClick={() => isOwner && setEditingName(true)}
          >
            {board.name}
          </span>
        )}

        <span className={`editor-status${status === "error" && !wsOpen ? " is-error" : ""}`}>{statusText}</span>

        <div className="editor-right">
          {peers.length > 0 && (
            <div className="peer-list">
              {peers.slice(0, 5).map((p) => (
                <button
                  key={p.pid}
                  className={`peer-dot${followPid === p.pid ? " is-followed" : ""}`}
                  style={{ background: p.color }}
                  title={followPid === p.pid ? `Перестать следовать за «${p.name}»` : `Следовать за «${p.name}»`}
                  onClick={() => toggleFollow(p.pid)}
                >
                  {p.name[0]?.toUpperCase()}
                </button>
              ))}
              {peers.length > 5 && <span className="peer-more">+{peers.length - 5}</span>}
            </div>
          )}
          <input
            className="editor-user"
            defaultValue={userName}
            title="Ваше имя для совместной работы"
            onBlur={(e) => commitUserName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
          />
          {!isViewer && (
            <button className="btn-hist" title="История версий" onClick={onHistory}>
              <ClockIcon /> История
            </button>
          )}
          {isOwner && (
            <button className="btn-share" onClick={onShare}>
              {tokens.edit ? "Доступ открыт" : "Поделиться"}
            </button>
          )}
        </div>

        {sharePop && (
          <div className="share-pop">
            <p className="share-label">Рисовать вместе — все с этой ссылкой могут редактировать:</p>
            <div className="share-row">
              <input readOnly value={linkFor(tokens.edit)} onFocus={(e) => e.target.select()} />
              <button className="btn-primary" onClick={() => copy(tokens.edit)}>Скопировать</button>
            </div>
            <p className="share-label">Только посмотреть — рисунок виден, но менять нельзя:</p>
            <div className="share-row">
              <input readOnly value={linkFor(tokens.view)} onFocus={(e) => e.target.select()} />
              <button className="btn-primary" onClick={() => copy(tokens.view)}>Скопировать</button>
            </div>
            <div className="share-actions">
              <button className="btn-danger-link" onClick={revokeShare}>Закрыть весь доступ</button>
              <button className="btn-link" onClick={() => setSharePop(false)}>Готово</button>
            </div>
          </div>
        )}

        {histOpen && (
          <div className="hist-pop">
            <p className="hist-title">История версий</p>
            {versions === null && <p className="hist-empty">Загружаем…</p>}
            {versions?.length === 0 && (
              <p className="hist-empty">Версий пока нет — они сохраняются сами каждые 10 минут работы над доской.</p>
            )}
            {versions?.length > 0 && (
              <div className="hist-body">
                <ul className="hist-list">
                  {versions.map((v) => (
                    <li key={v.id}>
                      <button
                        className={`hist-item${preview?.vid === v.id ? " is-active" : ""}`}
                        onClick={() => onPickVersion(v)}
                      >
                        {fmtVersion(v.at)}
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="hist-preview">
                  {!preview && <p className="hist-empty">Выберите версию слева, чтобы посмотреть её</p>}
                  {preview?.img === null && <p className="hist-empty">Рисуем превью…</p>}
                  {preview?.img === "error" && <p className="hist-empty">Превью не получилось, но восстановить всё равно можно</p>}
                  {preview?.img && preview.img !== "error" && <img src={preview.img} alt="" />}
                  {preview && (
                    <>
                      <button className="btn-primary" disabled={restoring} onClick={onRestoreVersion}>
                        {restoring ? "Восстанавливаем…" : "Восстановить эту версию"}
                      </button>
                      <p className="hist-note">Текущий рисунок тоже сохранится в истории.</p>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </header>

      <div
        ref={canvasRef}
        className="editor-canvas"
        style={followPid ? { boxShadow: `inset 0 0 0 3px ${peers.find((p) => p.pid === followPid)?.color || "#6965db"}` } : undefined}
        onClick={() => {
          if (sharePop) setSharePop(false);
          if (histOpen) setHistOpen(false);
        }}
      >
        {followPid && (
          <div className="follow-pill" style={{ borderColor: peers.find((p) => p.pid === followPid)?.color }}>
            Следуете за «{peers.find((p) => p.pid === followPid)?.name}» · Esc — отстать
          </div>
        )}
        <Excalidraw
          excalidrawAPI={setApi}
          langCode="ru-RU"
          initialData={{
            elements: board.scene?.elements || [],
            appState: { ...board.scene?.appState, ...loadViewport(id) },
            files: board.scene?.files || {},
          }}
          onChange={onChange}
          onPointerUpdate={onPointerUpdate}
          viewModeEnabled={isViewer}
          UIOptions={{ canvasActions: { toggleTheme: false } }}
        />
      </div>
    </div>
  );
}
