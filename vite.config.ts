import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import obfuscator from "vite-plugin-obfuscator";

const host = process.env.TAURI_DEV_HOST;
const isProd = process.env.NODE_ENV === "production";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(isProd
      ? [
          obfuscator({
            options: {
              compact: true,
              controlFlowFlattening: true,
              controlFlowFlatteningThreshold: 0.5,
              deadCodeInjection: true,
              deadCodeInjectionThreshold: 0.2,
              stringArray: true,
              stringArrayThreshold: 0.5,
              stringArrayEncoding: ["rc4"],
              renameGlobals: false,
              selfDefending: false,
              debugProtection: false,
            },
          }),
        ]
      : []),
  ],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 5174 } : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
