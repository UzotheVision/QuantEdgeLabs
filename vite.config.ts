import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(), // Enable to see exact error location
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Target modern browsers for smaller output
    target: "es2020",
    // Increase chunk size warning limit (we're splitting intelligently below)
    chunkSizeWarningLimit: 600,
    // Enable CSS code splitting
    cssCodeSplit: true,
    // Minify with esbuild (faster than terser, good compression)
    minify: "esbuild",
    // Let Vite/Rollup handle chunk splitting automatically.
    // Manual chunking causes circular dependency TDZ crashes between vendor packages.
  },
  server: {
    hmr: {
      overlay: true, // Enable error overlay to show exact error location
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
