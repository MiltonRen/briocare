import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // any ngrok tunnel may front the dev server (random subdomain per run)
    allowedHosts: [".ngrok-free.app"],
  },
});
