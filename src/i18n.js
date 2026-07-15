/** Локализация: язык берётся из браузера, переключатель на дашборде
 * пишет boards.lang и перезагружает страницу — без реактивности, просто. */

const ru = {
  app_title: "Мои доски",
  boards_h1: "Доски",
  new_board: "+ Новая доска",
  default_board_name: "Доска {n}",
  tab_mine: "Мои",
  tab_shared: "Поделились со мной",
  tab_trash: "Корзина",
  load_failed_h: "Список не загрузился",
  load_failed_p: "{err}. Обновите страницу — обычно этого достаточно.",
  empty_mine_h: "Здесь будут ваши доски",
  empty_mine_p: "Нажмите, чтобы нарисовать первую",
  empty_shared_h: "Пока никто не поделился",
  empty_shared_p: "Доска появится здесь, как только вы откроете чужую ссылку",
  empty_trash_h: "Корзина пуста",
  empty_trash_p: "Удалённые доски лежат здесь 30 дней, потом исчезают насовсем",
  blank_sheet: "пустой лист",
  loading_boards: "Раскладываем листы…",
  today_at: "сегодня в {time}",
  restore: "Восстановить",
  delete_forever: "Удалить насовсем",
  rename: "Переименовать",
  delete: "Удалить",
  remove_from_list: "Убрать из списка",
  shared_badge: "Открыт доступ по ссылке",
  mode_view: "просмотр",
  mode_edit: "редактирование",
  modal_trash_h: "В корзину?",
  modal_forever_h: "Удалить насовсем?",
  modal_trash_p: "«{name}» отправится в корзину. Оттуда её можно вернуть в течение 30 дней, потом она удалится сама.",
  modal_forever_p: "«{name}» исчезнет безвозвратно — вместе со всем, что на ней нарисовано.",
  keep: "Оставить",
  to_trash: "В корзину",
  gone_today: "исчезнет сегодня",

  status_viewer: "режим просмотра",
  status_online: "синхронизация онлайн",
  status_saved: "сохранено",
  status_saving: "сохранение…",
  status_error: "не сохранилось — проверьте сеть",
  back_title: "К моим доскам",
  rename_title: "Нажмите, чтобы переименовать",
  follow: "Следовать за «{name}»",
  unfollow: "Перестать следовать за «{name}»",
  your_name_title: "Ваше имя для совместной работы",
  history: "История",
  history_title: "История версий",
  share: "Поделиться",
  share_open: "Доступ открыт",
  share_edit_label: "Рисовать вместе — все с этой ссылкой могут редактировать:",
  share_view_label: "Только посмотреть — рисунок виден, но менять нельзя:",
  copy: "Скопировать",
  revoke: "Закрыть весь доступ",
  done: "Готово",
  hist_loading: "Загружаем…",
  hist_none: "Версий пока нет — они сохраняются сами каждые 10 минут работы над доской.",
  hist_pick: "Выберите версию слева, чтобы посмотреть её",
  hist_prev_loading: "Рисуем превью…",
  hist_prev_error: "Превью не получилось, но восстановить всё равно можно",
  hist_restore: "Восстановить эту версию",
  hist_restoring: "Восстанавливаем…",
  hist_note: "Текущий рисунок тоже сохранится в истории.",
  follow_pill: "Следуете за «{name}» · Esc — отстать",
  err_open_h: "Не получилось открыть доску",
  err_back: "← К моим доскам",
  opening: "Открываем доску…",
  owner_revoked: "Владелец закрыл доступ к доске",

  agent_btn: "Ассистент",
  agent_btn_title: "AI-ассистент: нарисует и поправит по вашей просьбе",
  agent_title: "Ассистент",
  agent_clear: "очистить",
  agent_clear_title: "Начать разговор заново",
  agent_close_title: "Свернуть",
  agent_empty: "Попросите нарисовать схему, разложить мысли по стикерам или навести порядок — я вижу вашу доску и рисую прямо на ней.",
  agent_placeholder: "Что нарисовать или поправить?",
  agent_send: "Отправить",
  mic_start: "Надиктовать",
  mic_stop: "Остановить и распознать",
  agent_offline: "Не получилось связаться с ассистентом. Попробуйте ещё раз.",
  agent_disconnected: "⚠ Связь с ассистентом оборвалась.",
  tool_get_scene: "смотрю на доску",
  tool_add_mermaid: "рисую схему",
  tool_add_elements: "добавляю элементы",
  tool_update_elements: "правлю элементы",
  tool_delete_elements: "удаляю элементы",
  tool_zoom_to: "показываю результат",
};

const en = {
  app_title: "My boards",
  boards_h1: "Boards",
  new_board: "+ New board",
  default_board_name: "Board {n}",
  tab_mine: "Mine",
  tab_shared: "Shared with me",
  tab_trash: "Trash",
  load_failed_h: "Couldn't load the list",
  load_failed_p: "{err}. Refresh the page — that usually helps.",
  empty_mine_h: "Your boards will live here",
  empty_mine_p: "Click to draw your first one",
  empty_shared_h: "Nothing shared yet",
  empty_shared_p: "A board shows up here once you open someone's link",
  empty_trash_h: "Trash is empty",
  empty_trash_p: "Deleted boards stay here for 30 days, then vanish for good",
  blank_sheet: "blank sheet",
  loading_boards: "Laying out the sheets…",
  today_at: "today at {time}",
  restore: "Restore",
  delete_forever: "Delete forever",
  rename: "Rename",
  delete: "Delete",
  remove_from_list: "Remove from list",
  shared_badge: "Shared via link",
  mode_view: "view",
  mode_edit: "edit",
  modal_trash_h: "Move to trash?",
  modal_forever_h: "Delete forever?",
  modal_trash_p: "“{name}” goes to the trash. You can bring it back within 30 days; after that it deletes itself.",
  modal_forever_p: "“{name}” will be gone for good — along with everything drawn on it.",
  keep: "Keep",
  to_trash: "To trash",
  gone_today: "disappears today",

  status_viewer: "view only",
  status_online: "live sync on",
  status_saved: "saved",
  status_saving: "saving…",
  status_error: "not saved — check your connection",
  back_title: "Back to my boards",
  rename_title: "Click to rename",
  follow: "Follow “{name}”",
  unfollow: "Stop following “{name}”",
  your_name_title: "Your name for collaboration",
  history: "History",
  history_title: "Version history",
  share: "Share",
  share_open: "Sharing is on",
  share_edit_label: "Draw together — anyone with this link can edit:",
  share_view_label: "View only — the drawing is visible but can't be changed:",
  copy: "Copy",
  revoke: "Turn off all sharing",
  done: "Done",
  hist_loading: "Loading…",
  hist_none: "No versions yet — they save themselves every 10 minutes of work on the board.",
  hist_pick: "Pick a version on the left to preview it",
  hist_prev_loading: "Drawing the preview…",
  hist_prev_error: "Preview failed, but restoring still works",
  hist_restore: "Restore this version",
  hist_restoring: "Restoring…",
  hist_note: "The current drawing is saved to history too.",
  follow_pill: "Following “{name}” · Esc to stop",
  err_open_h: "Couldn't open the board",
  err_back: "← Back to my boards",
  opening: "Opening the board…",
  owner_revoked: "The owner turned off access to this board",

  agent_btn: "Assistant",
  agent_btn_title: "AI assistant: draws and edits at your request",
  agent_title: "Assistant",
  agent_clear: "clear",
  agent_clear_title: "Start the conversation over",
  agent_close_title: "Collapse",
  agent_empty: "Ask me to draw a diagram, lay out ideas as sticky notes, or tidy things up — I see your board and draw right on it.",
  agent_placeholder: "What should I draw or fix?",
  agent_send: "Send",
  mic_start: "Dictate",
  mic_stop: "Stop and transcribe",
  agent_offline: "Couldn't reach the assistant. Please try again.",
  agent_disconnected: "⚠ Lost connection to the assistant.",
  tool_get_scene: "looking at the board",
  tool_add_mermaid: "drawing a diagram",
  tool_add_elements: "adding elements",
  tool_update_elements: "editing elements",
  tool_delete_elements: "deleting elements",
  tool_zoom_to: "showing the result",
};

export function getLang() {
  const saved = localStorage.getItem("boards.lang");
  if (saved === "ru" || saved === "en") return saved;
  return (navigator.language || "en").toLowerCase().startsWith("ru") ? "ru" : "en";
}

export const lang = getLang();

export function setLang(l) {
  localStorage.setItem("boards.lang", l);
  location.reload();
}

const dict = lang === "ru" ? ru : en;

export function t(key, vars) {
  let s = dict[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export const locale = lang === "ru" ? "ru-RU" : "en-US";

/** «исчезнет через N дней» с русскими склонениями / "disappears in N days" */
export function daysLeftLabel(deletedAt) {
  const left = Math.max(0, 30 - Math.floor((Date.now() - Date.parse(deletedAt)) / 86400000));
  if (left === 0) return t("gone_today");
  if (lang === "en") return `disappears in ${left} ${left === 1 ? "day" : "days"}`;
  const m10 = left % 10, m100 = left % 100;
  const word =
    m10 === 1 && m100 !== 11 ? "день" : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "дня" : "дней";
  return `исчезнет через ${left} ${word}`;
}
