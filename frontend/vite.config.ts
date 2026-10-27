import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In dev, Vite serves the React app and forwards /api calls to the FastAPI server.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:8000" } },
  build: {
    rolldownOptions: {
      output: {
        // Libraries change far less often than the app, so they ship as their own files
        // (downloaded in parallel) that browsers keep cached across deploys.
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 2 },
            { name: "charts", test: /node_modules/, priority: 1 },
          ],
        },
      },
    },
  },
});
