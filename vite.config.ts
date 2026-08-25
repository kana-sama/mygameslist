/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
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
  build: {
    rolldownOptions: {
      preserveEntrySignatures: false,
      output: {
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [
            { name: "vendor-monaco", test: /[\\/]node_modules[\\/]monaco-editor[\\/]/ },
            { name: "vendor-framework", test: /[\\/]node_modules[\\/](?:react|react-dom|react-router|react-router-dom|scheduler)[\\/]/ },
            { name: "vendor-markdown", includeDependenciesRecursively: true, test: /[\\/]node_modules[\\/](?:react-markdown|remark-gfm|remark-parse|remark-rehype|unified|mdast-util-[^\\/]+|micromark[^\\/]*|hast-util-[^\\/]+|vfile[^\\/]*)[\\/]/ },
            { name: "vendor-tools", test: /[\\/]node_modules[\\/](?:@dnd-kit|diff|yaml)[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    exclude: [...configDefaults.exclude, ".superpowers/**"],
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
