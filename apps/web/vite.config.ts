import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const keyPath = resolve(import.meta.dirname, "../../infra/certs/localhost-key.pem");
const certPath = resolve(import.meta.dirname, "../../infra/certs/localhost-cert.pem");
const hasCertificates = existsSync(keyPath) && existsSync(certPath);
const backendProxy = {
  "/health": "http://127.0.0.1:4443",
  "/ws": {
    target: "ws://127.0.0.1:4443",
    ws: true,
  },
};

export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        app: resolve(import.meta.dirname, "index.html"),
        mediaHarness: resolve(import.meta.dirname, "stage3-harness.html"),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: backendProxy,
    ...(hasCertificates
      ? {
          https: {
            key: readFileSync(keyPath),
            cert: readFileSync(certPath),
          },
        }
      : {}),
  },
});
