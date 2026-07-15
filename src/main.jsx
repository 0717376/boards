import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { t, lang } from "./i18n.js";
import "./styles.css";

document.title = t("app_title");
document.documentElement.lang = lang;

createRoot(document.getElementById("root")).render(<App />);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
