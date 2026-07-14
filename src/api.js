async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `${res.status}`);
  }
  return res.json();
}

const q = (token) => (token ? `?token=${encodeURIComponent(token)}` : "");

export const listBoards = () => req("GET", "/api/boards");
export const createBoard = (name) => req("POST", "/api/boards", { name });
export const getBoard = (id, token) => req("GET", `/api/boards/${id}${q(token)}`);
export const updateBoard = (id, patch, token) => req("PATCH", `/api/boards/${id}${q(token)}`, patch);
export const deleteBoard = (id) => req("DELETE", `/api/boards/${id}`);
export const enableShare = (id) => req("POST", `/api/boards/${id}/share`);
export const disableShare = (id) => req("DELETE", `/api/boards/${id}/share`);
export const listShared = () => req("GET", "/api/shared");
export const removeShared = (id) => req("DELETE", `/api/shared/${id}`);
export const listTrash = () => req("GET", "/api/boards?trash=1");
export const restoreBoard = (id) => req("POST", `/api/boards/${id}/restore`);
export const listVersions = (id, token) => req("GET", `/api/boards/${id}/versions${q(token)}`);
export const getVersion = (id, vid, token) => req("GET", `/api/boards/${id}/versions/${vid}${q(token)}`);
export const restoreVersion = (id, vid, token) => req("POST", `/api/boards/${id}/versions/${vid}/restore${q(token)}`);
