import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    "process.env.IS_PREACT": JSON.stringify("false"),
  },
  server: {
    proxy: {
      "/api": "http://localhost:3199",
      "/ws": { target: "ws://localhost:3199", ws: true },
    },
  },
});
