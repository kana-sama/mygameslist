/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { librarySourcePlugin } from "./scripts/vite-library-source-plugin";

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [
    librarySourcePlugin({ sourceRoot: resolve(projectRoot, "data") }),
    react(),
  ],
  optimizeDeps: {
    exclude: ["@jsquash/webp", "@jsquash/webp/encode"],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
