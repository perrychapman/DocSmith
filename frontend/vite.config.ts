import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_ELECTRON ? './' : '/', // Use relative paths for Electron, absolute for web
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 5173,
    strictPort: false, // Allow Vite to use next available port if 5173 is taken
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
