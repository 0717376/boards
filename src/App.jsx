import React, { useEffect, useState } from "react";
import Dashboard from "./Dashboard.jsx";
import BoardEditor from "./BoardEditor.jsx";

function parseHash() {
  let m = location.hash.match(/^#\/b\/([0-9a-f-]{36})$/);
  if (m) return { view: "board", id: m[1], token: null };
  m = location.hash.match(/^#\/s\/([0-9a-f-]{36})\/([0-9a-f]{6,64})$/);
  if (m) return { view: "board", id: m[1], token: m[2] };
  return { view: "dashboard" };
}

export default function App() {
  const [route, setRoute] = useState(parseHash);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return route.view === "board" ? (
    <BoardEditor key={route.id + (route.token || "")} id={route.id} token={route.token} />
  ) : (
    <Dashboard />
  );
}
