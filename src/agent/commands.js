/**
 * Исполнитель команд агента: каждая команда приходит по чат-WS из sidecar-а,
 * выполняется здесь против живого excalidrawAPI, результат уходит обратно
 * как tool result. Всё, что агент рисует, идёт обычным путём синка (onChange).
 */
import { convertToExcalidrawElements, CaptureUpdateAction } from "@excalidraw/excalidraw";

const rnd = () => Math.floor(Math.random() * 0x7fffffff);

const FONT_CSS = {
  1: "Virgil",
  2: "Helvetica",
  3: "Cascadia Code",
  5: "Excalifont",
  6: "Nunito",
  7: "Lilita One",
  8: "Comic Shanns",
  9: "Liberation Sans",
};

function bbox(els) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of els) {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + (el.width || 0));
    maxY = Math.max(maxY, el.y + (el.height || 0));
  }
  return els.length
    ? { minX: Math.round(minX), minY: Math.round(minY), maxX: Math.round(maxX), maxY: Math.round(maxY) }
    : null;
}

function compactEl(el) {
  const c = {
    id: el.id,
    type: el.type,
    x: Math.round(el.x),
    y: Math.round(el.y),
    w: Math.round(el.width),
    h: Math.round(el.height),
  };
  if (el.angle) c.angle = +el.angle.toFixed(2);
  if (el.type === "text") {
    c.text = (el.text || "").slice(0, 300);
    c.fontSize = el.fontSize;
    if (el.containerId) c.labelOf = el.containerId;
  }
  if (el.strokeColor && el.strokeColor !== "#1e1e1e") c.stroke = el.strokeColor;
  if (el.backgroundColor && el.backgroundColor !== "transparent") c.bg = el.backgroundColor;
  if (el.type === "arrow" || el.type === "line") {
    if (el.startBinding?.elementId) c.from = el.startBinding.elementId;
    if (el.endBinding?.elementId) c.to = el.endBinding.elementId;
  }
  if (el.groupIds?.length) c.groups = el.groupIds;
  if (el.type === "frame" && el.name) c.name = el.name;
  return c;
}

function getScene(api) {
  const els = api.getSceneElements();
  const st = api.getAppState();
  const selection = Object.keys(st.selectedElementIds || {}).filter((k) => st.selectedElementIds[k]);
  const zoom = st.zoom?.value || 1;
  const viewport = {
    x: Math.round(-st.scrollX),
    y: Math.round(-st.scrollY),
    w: Math.round((st.width || window.innerWidth) / zoom),
    h: Math.round((st.height || window.innerHeight) / zoom),
  };
  let list = els;
  let note;
  if (els.length > 350) {
    const inVp = (el) =>
      el.x < viewport.x + viewport.w && el.x + el.width > viewport.x &&
      el.y < viewport.y + viewport.h && el.y + el.height > viewport.y;
    list = els.filter((el) => inVp(el) || selection.includes(el.id));
    note = `На доске ${els.length} элементов — показаны только видимые и выделенные (${list.length}).`;
  }
  return {
    ok: true,
    count: els.length,
    bounds: bbox(els),
    viewport,
    selection,
    ...(note ? { note } : {}),
    elements: list.map(compactEl),
  };
}

function appendElements(api, newEls) {
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...newEls],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

function addElements(api, args) {
  const skels = args.elements;
  if (!Array.isArray(skels) || !skels.length) return { ok: false, error: "elements: нужен непустой массив" };
  const existing = new Set(api.getSceneElementsIncludingDeleted().map((e) => e.id));
  const taken = skels.filter((s) => s.id && existing.has(s.id)).map((s) => s.id);
  if (taken.length) return { ok: false, error: `id уже заняты на доске: ${taken.join(", ")} — выберите другие` };
  const newEls = convertToExcalidrawElements(skels, { regenerateIds: false });
  appendElements(api, newEls);
  return { ok: true, added: newEls.map((e) => e.id), bounds: bbox(newEls) };
}

async function addMermaid(api, args) {
  const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
  let parsed;
  try {
    parsed = await parseMermaidToExcalidraw(args.mermaid);
  } catch (e) {
    return { ok: false, error: `Mermaid не распарсился: ${String(e?.message || e).slice(0, 300)}` };
  }
  let newEls = convertToExcalidrawElements(parsed.elements, { regenerateIds: true });
  if (!newEls.length) return { ok: false, error: "диаграмма получилась пустой" };

  const bb = bbox(newEls);
  let tx, ty;
  if (Number.isFinite(args.x) && Number.isFinite(args.y)) {
    tx = args.x;
    ty = args.y;
  } else {
    const els = api.getSceneElements();
    if (els.length) {
      const sb = bbox(els);
      tx = sb.maxX + 120;
      ty = sb.minY;
    } else {
      const st = api.getAppState();
      tx = -st.scrollX + 100;
      ty = -st.scrollY + 100;
    }
  }
  const dx = tx - bb.minX;
  const dy = ty - bb.minY;
  newEls = newEls.map((el) => ({ ...el, x: el.x + dx, y: el.y + dy }));
  if (parsed.files && Object.keys(parsed.files).length) api.addFiles(Object.values(parsed.files));
  appendElements(api, newEls);
  api.scrollToContent(newEls, { fitToViewport: true, animate: true, viewportZoomFactor: 0.8 });
  return { ok: true, added: newEls.map((e) => e.id), bounds: bbox(newEls) };
}

const UPDATABLE = new Set([
  "x", "y", "width", "height", "angle", "strokeColor", "backgroundColor", "fillStyle",
  "strokeWidth", "strokeStyle", "opacity", "roughness", "fontSize", "text",
]);

// Грубый перезамер текстового элемента: excalidraw рисует текст по сохранённым
// width/height, точный замер он сделает сам при следующем редактировании.
function remeasure(el) {
  const lines = String(el.text || "").split("\n");
  const fs = el.fontSize || 20;
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.font = `${fs}px ${FONT_CSS[el.fontFamily] || "Excalifont"}, Virgil, sans-serif`;
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width), 10);
  return { ...el, width, height: lines.length * fs * 1.25 };
}

function updateElements(api, args) {
  const updates = args.updates;
  if (!Array.isArray(updates) || !updates.length) return { ok: false, error: "updates: нужен непустой массив" };
  const byId = new Map(updates.filter((u) => u && u.id).map((u) => [u.id, u]));
  const updated = [];
  const els = api.getSceneElementsIncludingDeleted().map((el) => {
    const u = byId.get(el.id);
    if (!u || el.isDeleted) return el;
    let next = { ...el };
    let touched = false;
    for (const [k, v] of Object.entries(u)) {
      if (k === "id" || !UPDATABLE.has(k)) continue;
      next[k] = v;
      touched = true;
    }
    if (!touched) return el;
    if (el.type === "text" && ("text" in u || "fontSize" in u)) next = remeasure(next);
    updated.push(el.id);
    return { ...next, version: el.version + 1, versionNonce: rnd(), updated: Date.now() };
  });
  if (!updated.length) return { ok: false, error: "ни один id не найден на доске" };
  api.updateScene({ elements: els, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  const missing = [...byId.keys()].filter((id) => !updated.includes(id));
  return { ok: true, updated, ...(missing.length ? { missing } : {}) };
}

function deleteElements(api, args) {
  const ids = new Set(Array.isArray(args.ids) ? args.ids : []);
  if (!ids.size) return { ok: false, error: "ids: нужен непустой массив" };
  const all = api.getSceneElementsIncludingDeleted();
  // Каскад: у контейнера удаляем и его подпись-лейбл.
  for (const el of all) {
    if (ids.has(el.id) && el.boundElements) {
      for (const b of el.boundElements) if (b.type === "text") ids.add(b.id);
    }
  }
  const deleted = [];
  const els = all.map((el) => {
    if (!ids.has(el.id) || el.isDeleted) return el;
    deleted.push(el.id);
    return { ...el, isDeleted: true, version: el.version + 1, versionNonce: rnd(), updated: Date.now() };
  });
  if (!deleted.length) return { ok: false, error: "ни один id не найден на доске" };
  api.updateScene({ elements: els, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  return { ok: true, deleted };
}

function zoomTo(api, args) {
  let ids = args.ids ?? args.elementIds ?? [];
  if (typeof ids === "string") {
    try { ids = JSON.parse(ids); } catch { ids = []; }
  }
  if (!Array.isArray(ids)) ids = [];
  const els = ids.length ? api.getSceneElements().filter((e) => ids.includes(e.id)) : api.getSceneElements();
  if (!els.length) return { ok: false, error: "элементы не найдены" };
  api.scrollToContent(els, { fitToViewport: true, animate: true, viewportZoomFactor: 0.7 });
  return { ok: true };
}

export async function executeCommand(api, name, args) {
  if (!api) return { ok: false, error: "доска ещё не загрузилась" };
  try {
    switch (name) {
      case "get_scene": return getScene(api);
      case "add_elements": return addElements(api, args);
      case "add_mermaid": return await addMermaid(api, args);
      case "update_elements": return updateElements(api, args);
      case "delete_elements": return deleteElements(api, args);
      case "zoom_to": return zoomTo(api, args);
      default: return { ok: false, error: `неизвестная команда ${name}` };
    }
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 500) };
  }
}
