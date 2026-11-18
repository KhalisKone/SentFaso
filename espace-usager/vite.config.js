import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En développement, les appels à l'API du socle sont relayés vers le backend FastAPI.
const SOCLE = process.env.SOCLE_URL || "http://127.0.0.1:8100";

export default defineConfig({
  base: "/frontend/",
  plugins: [react()],
  server: {
    proxy: { "/etat": SOCLE, "/connect": SOCLE },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
