import React, { useEffect, useState } from "react";
import {
  listBoards,
  createBoard,
  updateBoard,
  deleteBoard,
  listShared,
  removeShared,
  listTrash,
  restoreBoard,
} from "./api.js";

function fmtDate(iso) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return `сегодня в ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

const thumbSrc = (t) => (t.startsWith("data:image/") ? t : `data:image/svg+xml;utf8,${encodeURIComponent(t)}`);

export default function Dashboard() {
  const [boards, setBoards] = useState(null);
  const [shared, setShared] = useState([]);
  const [trash, setTrash] = useState([]);
  const [error, setError] = useState(null);
  const [renaming, setRenaming] = useState(null); // board id
  const [toDelete, setToDelete] = useState(null); // board object
  const [tab, setTab] = useState(() => localStorage.getItem("boards.dashTab") || "mine");

  const switchTab = (t) => {
    setTab(t);
    localStorage.setItem("boards.dashTab", t);
  };

  const refresh = () =>
    Promise.all([listBoards(), listShared().catch(() => []), listTrash().catch(() => [])])
      .then(([b, s, t]) => {
        setBoards(b);
        setShared(s);
        setTrash(t);
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!toDelete) return;
    const onKey = (e) => e.key === "Escape" && setToDelete(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toDelete]);

  const onCreate = async () => {
    const n = (boards?.length || 0) + 1;
    const b = await createBoard(`Доска ${n}`);
    location.hash = `#/b/${b.id}`;
  };

  const commitRename = async (b, name) => {
    setRenaming(null);
    const clean = name.trim();
    if (!clean || clean === b.name) return;
    setBoards((list) => list.map((x) => (x.id === b.id ? { ...x, name: clean } : x)));
    await updateBoard(b.id, { name: clean }).catch(() => refresh());
  };

  const confirmDelete = async () => {
    const b = toDelete;
    setToDelete(null);
    if (b.deletedAt) setTrash((list) => list.filter((x) => x.id !== b.id));
    else setBoards((list) => list.filter((x) => x.id !== b.id));
    await deleteBoard(b.id).catch(() => {});
    refresh();
  };

  const onRestore = async (b) => {
    setTrash((list) => list.filter((x) => x.id !== b.id));
    await restoreBoard(b.id).catch(() => {});
    refresh();
  };

  const onRemoveShared = async (b) => {
    setShared((list) => list.filter((x) => x.id !== b.id));
    await removeShared(b.id).catch(() => refresh());
  };

  return (
    <div className="desk">
      <div className="dash">
        <header className="dash-header">
          <h1>Доски</h1>
          <button className="btn-primary btn-new" onClick={onCreate}>
            + Новая доска
          </button>
        </header>

        <nav className="dash-tabs">
          <button className={`dash-tab${tab === "mine" ? " is-active" : ""}`} onClick={() => switchTab("mine")}>
            Мои
            {boards?.length > 0 && <span className="tab-count">{boards.length}</span>}
          </button>
          <button className={`dash-tab${tab === "shared" ? " is-active" : ""}`} onClick={() => switchTab("shared")}>
            Поделились со мной
            {shared.length > 0 && <span className="tab-count">{shared.length}</span>}
          </button>
          <button className={`dash-tab${tab === "trash" ? " is-active" : ""}`} onClick={() => switchTab("trash")}>
            Корзина
            {trash.length > 0 && <span className="tab-count">{trash.length}</span>}
          </button>
        </nav>

        {error && (
          <div className="dash-note">
            <h2>Список не загрузился</h2>
            <p>{error}. Обновите страницу — обычно этого достаточно.</p>
          </div>
        )}

        {tab === "mine" && boards?.length === 0 && (
          <div className="dash-note dash-empty" onClick={onCreate}>
            <EmptyDoodle />
            <h2>Здесь будут ваши доски</h2>
            <p>Нажмите, чтобы нарисовать первую</p>
          </div>
        )}

        {tab === "shared" && shared.length === 0 && (
          <div className="dash-note">
            <EmptyDoodle />
            <h2>Пока никто не поделился</h2>
            <p>Доска появится здесь, как только вы откроете чужую ссылку</p>
          </div>
        )}

        {tab === "trash" && trash.length === 0 && (
          <div className="dash-note">
            <h2>Корзина пуста</h2>
            <p>Удалённые доски лежат здесь 30 дней, потом исчезают насовсем</p>
          </div>
        )}

        {tab === "trash" && trash.length > 0 && (
          <div className="board-grid">
            {trash.map((b) => (
              <article key={b.id} className="board-card is-trashed">
                <div className="board-thumb">
                  {b.thumb ? (
                    <img src={thumbSrc(b.thumb)} alt="" loading="lazy" />
                  ) : (
                    <span className="board-thumb-blank">пустой лист</span>
                  )}
                </div>
                <div className="board-meta">
                  <h3 className="board-name">{b.name}</h3>
                  <p className="board-date">{daysLeft(b.deletedAt)}</p>
                </div>
                <div className="board-actions is-visible" onClick={(e) => e.stopPropagation()}>
                  <button title="Восстановить" onClick={() => onRestore(b)}>
                    <RestoreIcon />
                  </button>
                  <button title="Удалить насовсем" className="is-danger" onClick={() => setToDelete(b)}>
                    <TrashIcon />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}

        <div className="board-grid">
          {tab === "mine" && boards?.map((b, i) => (
            <article
              key={b.id}
              className="board-card"
              style={{ "--tilt": `${[-0.7, 0.5, -0.4, 0.8, -0.6, 0.4][i % 6]}deg` }}
              onClick={() => renaming !== b.id && (location.hash = `#/b/${b.id}`)}
            >
              <div className="board-thumb">
                {b.thumb ? (
                  <img src={thumbSrc(b.thumb)} alt="" loading="lazy" />
                ) : (
                  <span className="board-thumb-blank">пустой лист</span>
                )}
              </div>

              <div className="board-meta">
                {renaming === b.id ? (
                  <input
                    className="board-rename"
                    autoFocus
                    defaultValue={b.name}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => commitRename(b, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(b, e.target.value);
                      if (e.key === "Escape") setRenaming(null);
                    }}
                  />
                ) : (
                  <h3 className="board-name">{b.name}</h3>
                )}
                <p className="board-date">
                  {fmtDate(b.updatedAt)}
                  {b.shared && (
                    <span className="board-shared" title="Открыт доступ по ссылке">
                      <CloudIcon />
                    </span>
                  )}
                </p>
              </div>

              <div className="board-actions" onClick={(e) => e.stopPropagation()}>
                <button title="Переименовать" onClick={() => setRenaming(b.id)}>
                  <PencilIcon />
                </button>
                <button title="Удалить" className="is-danger" onClick={() => setToDelete(b)}>
                  <TrashIcon />
                </button>
              </div>
            </article>
          ))}
        </div>

        {tab === "shared" && (
          <>
            <div className="board-grid">
              {shared.map((b, i) => (
                <article
                  key={b.id}
                  className="board-card"
                  style={{ "--tilt": `${[0.6, -0.5, 0.4, -0.7, 0.5, -0.4][i % 6]}deg` }}
                  onClick={() => (location.hash = `#/s/${b.id}/${b.token}`)}
                >
                  <div className="board-thumb">
                    {b.thumb ? (
                      <img src={thumbSrc(b.thumb)} alt="" loading="lazy" />
                    ) : (
                      <span className="board-thumb-blank">пустой лист</span>
                    )}
                    <span className={`mode-badge${b.mode === "view" ? " is-view" : ""}`}>
                      {b.mode === "view" ? <EyeIcon /> : <PencilIcon />}
                      {b.mode === "view" ? "просмотр" : "редактирование"}
                    </span>
                  </div>
                  <div className="board-meta">
                    <h3 className="board-name">{b.name}</h3>
                    <p className="board-date">{fmtDate(b.updatedAt)}</p>
                  </div>
                  <div className="board-actions" onClick={(e) => e.stopPropagation()}>
                    <button title="Убрать из списка" onClick={() => onRemoveShared(b)}>
                      <XIcon />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}

        {boards === null && !error && <p className="dash-loading">Раскладываем листы…</p>}
      </div>

      {toDelete && (
        <div className="modal-backdrop" onClick={() => setToDelete(null)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>{toDelete.deletedAt ? "Удалить насовсем?" : "В корзину?"}</h2>
            <p>
              {toDelete.deletedAt
                ? `«${toDelete.name}» исчезнет безвозвратно — вместе со всем, что на ней нарисовано.`
                : `«${toDelete.name}» отправится в корзину. Оттуда её можно вернуть в течение 30 дней, потом она удалится сама.`}
            </p>
            <div className="modal-actions">
              <button className="btn-ghost" autoFocus onClick={() => setToDelete(null)}>
                Оставить
              </button>
              <button className="btn-danger" onClick={confirmDelete}>
                {toDelete.deletedAt ? "Удалить насовсем" : "В корзину"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function daysLeft(deletedAt) {
  const left = Math.max(0, 30 - Math.floor((Date.now() - Date.parse(deletedAt)) / 86400000));
  if (left === 0) return "исчезнет сегодня";
  return `исчезнет через ${left} ${plural(left, "день", "дня", "дней")}`;
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const PencilIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M17 3l4 4L8 20l-5 1 1-5L17 3z" />
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
  </svg>
);

const CloudIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
  </svg>
);

const EyeIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const RestoreIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l3 3" />
  </svg>
);

const XIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

const EmptyDoodle = () => (
  <svg className="empty-doodle" width="120" height="90" viewBox="0 0 120 90" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <rect x="14" y="12" width="92" height="64" rx="3" transform="rotate(-1.5 60 44)" />
    <path d="M32 55 C 42 30, 55 30, 62 44 S 82 62, 90 36" />
    <path d="M91.6 42.8 L90 36 L84.9 40.8" />
  </svg>
);
