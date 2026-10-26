import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

export default defineConfig(async ({ mode }) => {
  const workspaceRoot = path.resolve(import.meta.dirname, "..", "..");
  const fileEnvironment = loadEnv(mode, workspaceRoot, "");
  const environment = { ...fileEnvironment, ...process.env };
  const rawPort = environment.VITE_PORT ?? environment.PORT;
  const localApiProxyTarget = environment.LOCAL_API_PROXY_TARGET;

  if (!rawPort) {
    throw new Error(
      "VITE_PORT (or PORT) environment variable is required but was not provided.",
    );
  }

  const port = Number(rawPort);
  const host = environment.VITE_HOST ?? "0.0.0.0";

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid VITE_PORT value: "${rawPort}"`);
  }

  const basePath = environment.BASE_PATH;

  if (!basePath) {
    throw new Error(
      "BASE_PATH environment variable is required but was not provided.",
    );
  }

  return {
    base: basePath,
    plugins: [
      react(),
      tailwindcss({ optimize: false }),
      runtimeErrorOverlay(),
      ...(process.env.NODE_ENV !== "production" &&
      process.env.REPL_ID !== undefined
        ? [
            await import("@replit/vite-plugin-cartographer").then((m) =>
              m.cartographer({
                root: path.resolve(import.meta.dirname, ".."),
              }),
            ),
            await import("@replit/vite-plugin-dev-banner").then((m) =>
              m.devBanner(),
            ),
          ]
        : []),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@assets": path.resolve(
          import.meta.dirname,
          "..",
          "..",
          "attached_assets",
        ),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(import.meta.dirname),
    envDir: workspaceRoot,
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      port,
      strictPort: true,
      host,
      allowedHosts: true,
      ...(localApiProxyTarget
        ? {
            proxy: {
              "/api": {
                target: localApiProxyTarget,
                changeOrigin: true,
                ws: true,
              },
            },
          }
        : {}),
      fs: {
        strict: true,
      },
    },
    preview: {
      port,
      host,
      allowedHosts: true,
    },
  };
});
