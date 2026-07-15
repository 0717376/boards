import http from "node:http";
import net from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3199);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const BOARDS_DIR = path.join(DATA_DIR, "boards");
const USERS_DIR = path.join(DATA_DIR, "users");
const VERSIONS_DIR = path.join(DATA_DIR, "versions");
const SNAPSHOT_MS = 10 * 60 * 1000;
const MAX_SNAPSHOTS = 50;
const TRASH_TTL_MS = 30 * 24 * 3600 * 1000;
const DIST_DIR = path.join(__dirname, "dist");
const MAX_BODY = 100 * 1024 * 1024;
const MAX_THUMB = 800 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
};

await fs.mkdir(BOARDS_DIR, { recursive: true });
await fs.mkdir(USERS_DIR, { recursive: true });
await fs.mkdir(VERSIONS_DIR, { recursive: true });

/* ---------- storage ---------- */

const boardPath = (id) => {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw Object.assign(new Error("bad id"), { status: 400 });
  return path.join(BOARDS_DIR, `${id}.json`);
};

async function readBoard(id) {
  try {
    return JSON.parse(await fs.readFile(boardPath(id), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") throw Object.assign(new Error("board not found"), { status: 404 });
    throw e;
  }
}

async function writeBoard(board) {
  const file = boardPath(board.id);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(board));
  await fs.rename(tmp, file);
}

const userPath = (uid) => {
  if (!/^[0-9a-f-]{36}$/.test(uid)) throw Object.assign(new Error("bad uid"), { status: 400 });
  return path.join(USERS_DIR, `${uid}.json`);
};

async function readUser(uid) {
  try {
    return JSON.parse(await fs.readFile(userPath(uid), "utf8"));
  } catch {
    return { shared: {} };
  }
}

async function writeUser(uid, data) {
  const file = userPath(uid);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data));
  await fs.rename(tmp, file);
}

/* ---------- versions ---------- */

const versionsDir = (id) => path.join(VERSIONS_DIR, id);

async function listVersionFiles(id) {
  try {
    return (await fs.readdir(versionsDir(id))).filter((f) => /^\d+\.json$/.test(f)).sort((a, b) => Number(a.slice(0, -5)) - Number(b.slice(0, -5)));
  } catch {
    return [];
  }
}

async function writeSnapshot(board) {
  const dir = versionsDir(board.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${Date.now()}.json`), JSON.stringify({ at: new Date().toISOString(), scene: board.scene }));
  const files = await listVersionFiles(board.id);
  for (const f of files.slice(0, Math.max(0, files.length - MAX_SNAPSHOTS))) {
    await fs.unlink(path.join(dir, f)).catch(() => {});
  }
}

async function maybeSnapshot(board) {
  try {
    if (!board.scene?.elements?.length) return;
    const files = await listVersionFiles(board.id);
    const newest = files.at(-1);
    if (newest) {
      if (Date.now() - Number(newest.slice(0, -5)) < SNAPSHOT_MS) return;
      const prev = JSON.parse(await fs.readFile(path.join(versionsDir(board.id), newest), "utf8"));
      if (JSON.stringify(prev.scene) === JSON.stringify(board.scene)) return;
    }
    await writeSnapshot(board);
  } catch (e) {
    console.error(`snapshot ${board.id}:`, e.message);
  }
}

/* ---------- trash ---------- */

async function purgeBoardFiles(id) {
  await fs.unlink(boardPath(id)).catch(() => {});
  await fs.rm(versionsDir(id), { recursive: true, force: true }).catch(() => {});
}

async function purgeExpiredTrash() {
  try {
    for (const f of (await fs.readdir(BOARDS_DIR)).filter((f) => f.endsWith(".json"))) {
      try {
        const b = JSON.parse(await fs.readFile(path.join(BOARDS_DIR, f), "utf8"));
        if (b.deletedAt && Date.now() - Date.parse(b.deletedAt) > TRASH_TTL_MS) {
          await purgeBoardFiles(b.id);
          console.log(`trash expired: ${b.id} (${b.name})`);
        }
      } catch {}
    }
  } catch (e) {
    console.error("trash purge:", e.message);
  }
}
purgeExpiredTrash();
setInterval(purgeExpiredTrash, 12 * 3600 * 1000);

/* ---------- helpers ---------- */

function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {});
      } catch {
        reject(Object.assign(new Error("invalid json"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, data, headers = {}) {
  const body = typeof data === "string" || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(body);
}

const canEdit = (board, uid, token) =>
  board.ownerId === uid || (board.shareToken && token && board.shareToken === token);
const canView = (board, uid, token) =>
  canEdit(board, uid, token) || (board.viewToken && token && board.viewToken === token);

/* ---------- collab rooms ---------- */

// roomId -> { els: Map<elId, element>, files: {}, appState, clients: Set<ws>, persistTimer, dirty }
const rooms = new Map();

const cmpIndex = (a, b) => ((a.index || "") < (b.index || "") ? -1 : (a.index || "") > (b.index || "") ? 1 : 0);

function mergeElements(room, incoming) {
  const fresh = [];
  for (const el of incoming) {
    if (!el || typeof el.id !== "string") continue;
    const cur = room.els.get(el.id);
    if (!cur || el.version > cur.version || (el.version === cur.version && el.versionNonce < cur.versionNonce)) {
      room.els.set(el.id, el);
      fresh.push(el);
    }
  }
  return fresh;
}

function getRoom(boardId) {
  let room = rooms.get(boardId);
  if (!room) {
    // created synchronously so concurrent joins share one room; state fills in via `ready`
    room = {
      els: new Map(),
      files: {},
      appState: {},
      clients: new Set(),
      persistTimer: null,
      dirty: false,
      ready: null,
    };
    room.ready = readBoard(boardId)
      .then((board) => {
        room.els = new Map((board.scene?.elements || []).map((e) => [e.id, e]));
        room.files = board.scene?.files || {};
        room.appState = board.scene?.appState || {};
      })
      .catch(() => {});
    rooms.set(boardId, room);
  }
  return room;
}

function roomScene(room) {
  return {
    type: "excalidraw",
    version: 2,
    source: "excalidraw-boards",
    elements: [...room.els.values()].filter((e) => !e.isDeleted).sort(cmpIndex),
    appState: room.appState,
    files: room.files,
  };
}

async function persistRoom(boardId, room) {
  if (!room.dirty) return;
  room.dirty = false;
  try {
    const board = await readBoard(boardId);
    board.scene = roomScene(room);
    board.updatedAt = new Date().toISOString();
    await writeBoard(board);
    maybeSnapshot(board);
  } catch (e) {
    if (e.status !== 404) console.error(`persist ${boardId}:`, e.message);
  }
}

function schedulePersist(boardId, room) {
  room.dirty = true;
  if (room.persistTimer) return;
  room.persistTimer = setTimeout(() => {
    room.persistTimer = null;
    persistRoom(boardId, room);
  }, 1500);
}

function broadcast(room, except, msg) {
  const data = JSON.stringify(msg);
  for (const c of room.clients) {
    if (c !== except && c.readyState === 1) c.send(data);
  }
}

const peersOf = (room) => [...room.clients].map((c) => ({ pid: c.pid, name: c.uname, color: c.ucolor }));

/* ---------- API ---------- */

async function handleApi(req, res, url, uid) {
  const parts = url.pathname.split("/").filter(Boolean); // api / boards / :id / share?

  if (parts[1] === "shared") {
    if (req.method === "GET" && !parts[2]) {
      const user = await readUser(uid);
      const list = [];
      let dirty = false;
      for (const [bid, entry] of Object.entries(user.shared || {})) {
        let ok = false;
        try {
          const b = await readBoard(bid);
          if (!b.deletedAt && b.ownerId !== uid && entry.token && (entry.token === b.shareToken || entry.token === b.viewToken)) {
            ok = true;
            list.push({
              id: b.id,
              name: b.name,
              updatedAt: b.updatedAt,
              thumb: b.thumb || null,
              mode: entry.token === b.shareToken ? "edit" : "view",
              token: entry.token,
            });
          }
        } catch {}
        if (!ok) {
          delete user.shared[bid];
          dirty = true;
        }
      }
      if (dirty) await writeUser(uid, user);
      list.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
      return send(res, 200, list);
    }
    if (req.method === "DELETE" && parts[2]) {
      const user = await readUser(uid);
      if (user.shared?.[parts[2]]) {
        delete user.shared[parts[2]];
        await writeUser(uid, user);
      }
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: "method not allowed" });
  }

  if (parts[1] !== "boards") return send(res, 404, { error: "not found" });
  const id = parts[2];
  const sub = parts[3];
  const token = url.searchParams.get("token") || "";

  if (!id) {
    if (req.method === "GET") {
      const wantTrash = url.searchParams.get("trash") === "1";
      const files = (await fs.readdir(BOARDS_DIR)).filter((f) => f.endsWith(".json"));
      const list = [];
      for (const f of files) {
        try {
          const b = JSON.parse(await fs.readFile(path.join(BOARDS_DIR, f), "utf8"));
          if (b.ownerId !== uid || !!b.deletedAt !== wantTrash) continue;
          list.push({
            id: b.id,
            name: b.name,
            createdAt: b.createdAt,
            updatedAt: b.updatedAt,
            deletedAt: b.deletedAt || undefined,
            shared: !!(b.shareToken || b.viewToken),
            thumb: b.thumb || null,
          });
        } catch {}
      }
      list.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
      return send(res, 200, list);
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      const now = new Date().toISOString();
      const board = {
        id: crypto.randomUUID(),
        ownerId: uid,
        name: String(body.name || "Без названия").slice(0, 200),
        shareToken: null,
        viewToken: null,
        thumb: null,
        createdAt: now,
        updatedAt: now,
        scene: null,
      };
      await writeBoard(board);
      return send(res, 201, { id: board.id, name: board.name, createdAt: now, updatedAt: now });
    }
    return send(res, 405, { error: "method not allowed" });
  }

  const board = await readBoard(id);
  const owner = board.ownerId === uid;

  if (sub === "restore" && req.method === "POST") {
    if (!owner) return send(res, 403, { error: "forbidden" });
    board.deletedAt = null;
    await writeBoard(board);
    return send(res, 200, { ok: true });
  }

  if (board.deletedAt && !(req.method === "DELETE" && !sub)) {
    return send(res, 404, { error: "board in trash" });
  }

  if (sub === "versions") {
    if (!canEdit(board, uid, token)) return send(res, 403, { error: "forbidden" });
    const vid = parts[4];
    const action = parts[5];
    if (req.method === "GET" && !vid) {
      const files = await listVersionFiles(id);
      return send(res, 200, files.map((f) => ({ id: f.slice(0, -5), at: new Date(Number(f.slice(0, -5))).toISOString() })).reverse());
    }
    if (!/^\d+$/.test(vid || "")) return send(res, 400, { error: "bad version id" });
    const vfile = path.join(versionsDir(id), `${vid}.json`);
    let version;
    try {
      version = JSON.parse(await fs.readFile(vfile, "utf8"));
    } catch {
      return send(res, 404, { error: "version not found" });
    }
    if (req.method === "GET") return send(res, 200, { id: vid, at: version.at, scene: version.scene });
    if (req.method === "POST" && action === "restore") {
      await writeSnapshot(board); // keep the current drawing recoverable
      board.scene = version.scene;
      board.updatedAt = new Date().toISOString();
      await writeBoard(board);
      const room = rooms.get(id);
      if (room) {
        room.dirty = false;
        clearTimeout(room.persistTimer);
        room.persistTimer = null;
        for (const c of [...room.clients]) c.close(4005, "version restored");
        rooms.delete(id);
      }
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: "method not allowed" });
  }

  if (sub === "share") {
    if (!owner) return send(res, 403, { error: "forbidden" });
    if (req.method === "POST") {
      if (!board.shareToken || !board.viewToken) {
        board.shareToken = board.shareToken || crypto.randomBytes(12).toString("hex");
        board.viewToken = board.viewToken || crypto.randomBytes(12).toString("hex");
        await writeBoard(board);
      }
      return send(res, 200, { shareToken: board.shareToken, viewToken: board.viewToken });
    }
    if (req.method === "DELETE") {
      board.shareToken = null;
      board.viewToken = null;
      await writeBoard(board);
      // kick guests out of the live room
      const room = rooms.get(id);
      if (room) for (const c of [...room.clients]) if (!c.isOwner) c.close(4003, "share revoked");
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: "method not allowed" });
  }

  if (req.method === "GET") {
    if (!canView(board, uid, token)) return send(res, 403, { error: "forbidden" });
    if (!owner && token) {
      // remember the visit so the board shows up under "shared with me"
      const user = await readUser(uid);
      user.shared = user.shared || {};
      user.shared[id] = { token, at: new Date().toISOString() };
      await writeUser(uid, user);
    }
    const room = rooms.get(id);
    return send(res, 200, {
      id: board.id,
      name: board.name,
      role: owner ? "owner" : canEdit(board, uid, token) ? "editor" : "viewer",
      shared: !!board.shareToken,
      shareToken: owner ? board.shareToken : undefined,
      viewToken: owner ? board.viewToken : undefined,
      hasThumb: !!board.thumb,
      createdAt: board.createdAt,
      updatedAt: board.updatedAt,
      scene: room ? roomScene(room) : board.scene,
    });
  }

  if (req.method === "PUT" || req.method === "PATCH") {
    if (!canEdit(board, uid, token)) return send(res, 403, { error: "forbidden" });
    const body = await readBody(req);
    if (body.name !== undefined && owner) board.name = String(body.name).slice(0, 200);
    if (body.thumb !== undefined) {
      board.thumb = typeof body.thumb === "string" && body.thumb.length <= MAX_THUMB ? body.thumb : null;
    }
    if (body.scene !== undefined) {
      const room = rooms.get(id);
      if (room && room.clients.size > 0) {
        // live room is authoritative: merge REST write into it instead of clobbering
        const fresh = mergeElements(room, body.scene?.elements || []);
        Object.assign(room.files, body.scene?.files || {});
        if (body.scene?.appState) room.appState = body.scene.appState;
        if (fresh.length) broadcast(room, null, { t: "el", els: fresh });
        schedulePersist(id, room);
        board.scene = roomScene(room);
      } else {
        board.scene = body.scene;
      }
      maybeSnapshot(board);
    }
    board.updatedAt = new Date().toISOString();
    await writeBoard(board);
    return send(res, 200, { id: board.id, name: board.name, updatedAt: board.updatedAt });
  }

  if (req.method === "DELETE") {
    if (!owner) return send(res, 403, { error: "forbidden" });
    const room = rooms.get(id);
    if (room) {
      room.dirty = false;
      clearTimeout(room.persistTimer);
      room.persistTimer = null;
      for (const c of [...room.clients]) c.close(4004, "board deleted");
      rooms.delete(id);
    }
    if (board.deletedAt) {
      await purgeBoardFiles(id); // already in trash → gone for good
    } else {
      board.deletedAt = new Date().toISOString();
      await writeBoard(board);
    }
    return send(res, 200, { ok: true });
  }

  return send(res, 405, { error: "method not allowed" });
}

/* ---------- static ---------- */

async function handleStatic(req, res, url) {
  let filePath = path.normalize(path.join(DIST_DIR, decodeURIComponent(url.pathname)));
  if (!filePath.startsWith(DIST_DIR)) return send(res, 403, { error: "forbidden" });
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
  } catch {
    filePath = path.join(DIST_DIR, "index.html");
  }
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const cache = ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable";
    send(res, 200, data, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": cache });
  } catch {
    send(res, 404, { error: "not found" });
  }
}

/* ---------- agent sidecar proxy ---------- */

const AGENT_UPSTREAM = process.env.AGENT_UPSTREAM || ""; // "host:port"; empty = агент выключен

function agentTarget() {
  const [host, port] = AGENT_UPSTREAM.split(":");
  return { host, port: Number(port || 8000) };
}

async function handleAgent(req, res, url) {
  if (!AGENT_UPSTREAM) return send(res, 503, { error: "agent disabled" });
  let target = null;
  if (req.method === "GET" && url.pathname === "/agent/health") target = "/health";
  else if (req.method === "POST" && url.pathname === "/agent/asr") target = "/asr/transcribe";
  if (!target) return send(res, 404, { error: "not found" });
  const { host, port } = agentTarget();
  const headers = { "content-type": req.headers["content-type"] || "application/octet-stream" };
  if (req.headers["content-length"]) headers["content-length"] = req.headers["content-length"];
  const preq = http.request({ host, port, path: target, method: req.method, headers }, (pres) => {
    res.writeHead(pres.statusCode || 502, { "Content-Type": pres.headers["content-type"] || "application/json" });
    pres.pipe(res);
  });
  preq.on("error", () => {
    if (!res.headersSent) send(res, 502, { error: "agent unavailable" });
    else res.destroy();
  });
  req.pipe(preq);
}

// WS upgrade for /agent/chat: права проверяются здесь (у sidecar-а нет доступа к доскам),
// затем сырой TCP-пайп до контейнера агента.
async function upgradeAgent(req, socket, head, url) {
  try {
    if (!AGENT_UPSTREAM) throw new Error("disabled");
    const boardId = url.searchParams.get("board") || "";
    const token = url.searchParams.get("token") || "";
    const uid = parseCookies(req.headers.cookie).uid || "";
    const board = await readBoard(boardId);
    if (board.deletedAt || !canEdit(board, uid, token)) throw new Error("forbidden");
    const { host, port } = agentTarget();
    const lang = url.searchParams.get("lang") === "en" ? "en" : "ru";
    const up = net.connect(port, host, () => {
      up.write(
        `GET /chat/ws?board=${encodeURIComponent(boardId)}&uid=${encodeURIComponent(uid)}&lang=${lang} HTTP/1.1\r\n` +
          `Host: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${req.headers["sec-websocket-key"]}\r\n` +
          `Sec-WebSocket-Version: ${req.headers["sec-websocket-version"] || "13"}\r\n\r\n`
      );
      if (head?.length) up.write(head);
      socket.pipe(up);
      up.pipe(socket);
    });
    const kill = () => {
      socket.destroy();
      up.destroy();
    };
    up.on("error", kill);
    socket.on("error", kill);
  } catch {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
  }
}

/* ---------- server ---------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let uid = parseCookies(req.headers.cookie).uid;
  if (!/^[0-9a-f-]{36}$/.test(uid || "")) {
    uid = crypto.randomUUID();
    res.setHeader("Set-Cookie", `uid=${uid}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`);
  }
  try {
    if (url.pathname.startsWith("/api/")) await handleApi(req, res, url, uid);
    else if (url.pathname.startsWith("/agent/")) await handleAgent(req, res, url);
    else await handleStatic(req, res, url);
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY });

server.on("upgrade", async (req, socket, head) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/agent/chat") return upgradeAgent(req, socket, head, url);
  if (url.pathname !== "/ws") return socket.destroy();
  const boardId = url.searchParams.get("board") || "";
  const token = url.searchParams.get("token") || "";
  const uid = parseCookies(req.headers.cookie).uid || "";
  try {
    const board = await readBoard(boardId);
    if (board.deletedAt || !canView(board, uid, token)) throw new Error("forbidden");
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.isOwner = board.ownerId === uid;
      ws.canEdit = canEdit(board, uid, token);
      wss.emit("connection", ws, boardId);
    });
  } catch {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
  }
});

wss.on("connection", async (ws, boardId) => {
  const room = getRoom(boardId);
  await room.ready;
  ws.pid = crypto.randomUUID();
  ws.uname = "Гость";
  ws.ucolor = "#868e96";

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.t) {
      case "join": {
        const rejoin = room.clients.has(ws);
        ws.uname = String(msg.name || "Гость").slice(0, 60);
        ws.ucolor = String(msg.color || "#868e96").slice(0, 30);
        ws.uhid = String(msg.hid || "").slice(0, 40);
        room.clients.add(ws);
        if (!rejoin) {
          ws.send(
            JSON.stringify({
              t: "init",
              pid: ws.pid,
              els: [...room.els.values()],
              files: room.files,
              peers: peersOf(room),
            })
          );
        }
        broadcast(room, rejoin ? null : ws, { t: "peers", peers: peersOf(room) });
        break;
      }
      case "el": {
        if (!ws.canEdit) break;
        const fresh = mergeElements(room, msg.els || []);
        if (fresh.length) {
          broadcast(room, ws, { t: "el", els: fresh });
          schedulePersist(boardId, room);
        }
        break;
      }
      case "files": {
        if (!ws.canEdit) break;
        Object.assign(room.files, msg.files || {});
        broadcast(room, ws, { t: "files", files: msg.files || {} });
        schedulePersist(boardId, room);
        break;
      }
      case "view": {
        const { sx, sy, z, w, h } = msg;
        if (![sx, sy, z, w, h].every(Number.isFinite) || z <= 0) break;
        broadcast(room, ws, { t: "view", pid: ws.pid, sx, sy, z, w, h });
        break;
      }
      case "ptr": {
        broadcast(room, ws, {
          t: "ptr",
          pid: ws.pid,
          name: ws.uname,
          color: ws.ucolor,
          hid: ws.uhid,
          btn: msg.btn === "down" ? "down" : "up",
          x: msg.x,
          y: msg.y,
          sel: msg.sel || [],
        });
        break;
      }
    }
  });

  ws.on("close", () => {
    room.clients.delete(ws);
    broadcast(room, null, { t: "peers", peers: peersOf(room) });
    if (room.clients.size === 0) {
      clearTimeout(room.persistTimer);
      room.persistTimer = null;
      persistRoom(boardId, room).finally(() => {
        if (room.clients.size === 0) rooms.delete(boardId);
      });
    }
  });
});

server.listen(PORT, () => console.log(`excalidraw-boards on :${PORT}, data in ${DATA_DIR}`));
