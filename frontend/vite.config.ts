import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In dev, Vite serves the React app and forwards /api calls to the FastAPI server.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:8000" } },
});
