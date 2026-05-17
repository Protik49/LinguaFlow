import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { writeFileSync, mkdirSync, existsSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const srcDir = resolve(__dirname, "src");

function copyManifestPlugin() {
  return {
    name: "copy-manifest",
    closeBundle() {
      const dist = resolve(__dirname, "dist");
      if (!existsSync(dist)) mkdirSync(dist, { recursive: true });
      if (!existsSync(resolve(dist, "icons")))
        mkdirSync(resolve(dist, "icons"), { recursive: true });

      const manifest = {
        manifest_version: 3,
        name: "LinguaFlow",
        version: "1.0.0",
        description:
          "AI-powered vocabulary learning — translate words inline while reading",
        permissions: ["storage"],
        host_permissions: ["https://openrouter.ai/*"],
        background: {
          service_worker: "background.js",
        },
        content_scripts: [
          {
            matches: ["<all_urls>"],
            js: ["content.js"],
            run_at: "document_end",
          },
        ],
        action: {
          default_popup: "popup/index.html",
          default_title: "LinguaFlow",
        },
        options_page: "options/index.html",
        icons: {
          "16": "icons/icon16.png",
          "48": "icons/icon48.png",
          "128": "icons/icon128.png",
        },
      };

      writeFileSync(
        resolve(dist, "manifest.json"),
        JSON.stringify(manifest, null, 2)
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), copyManifestPlugin()],
  root: srcDir,
  publicDir: false,
  resolve: {
    alias: {
      "@shared": resolve(srcDir, "shared"),
    },
  },
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: false,
    rollupOptions: {
      input: {
        popup: resolve(srcDir, "popup/index.html"),
        options: resolve(srcDir, "options/index.html"),
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },
});
