import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@tauri-apps/plugin-sql": path.resolve(process.cwd(), "scripts/smoke-render/db-stub.ts"),
    },
  },
  build: {
    ssr: true,
    outDir: "tmp/smoke-dist",
    emptyOutDir: false,
    minify: false,
    rollupOptions: {
      input: {
        app: "scripts/smoke-render/app-entry.tsx",
        graph: "scripts/smoke-render/graph-entry.tsx",
        calendar: "scripts/smoke-render/calendar-entry.tsx",
        dialog: "scripts/smoke-render/dialog-entry.tsx",
      },
    },
  },
});