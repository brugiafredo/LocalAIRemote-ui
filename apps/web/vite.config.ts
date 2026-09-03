import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";

function buildCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() || "dev";
  } catch {
    return "dev";
  }
}

function buildMetadataPlugin(commit: string) {
  return {
    name: "escarlet-local-ai-ui-build-metadata",
    writeBundle() {
      const metadataPath = fileURLToPath(new URL("./dist/build-meta.json", import.meta.url));
      writeFileSync(metadataPath, JSON.stringify({ commit, builtAt: new Date().toISOString() }) + "\n", "utf8");
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const clientCommit = env.VITE_BUILD_COMMIT?.trim() || buildCommit();
  return {
    define: {
      "import.meta.env.VITE_BUILD_COMMIT": JSON.stringify(clientCommit),
    },
    plugins: [
      vue(),
      buildMetadataPlugin(clientCommit),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["icon.svg"],
        manifest: {
          name: "Escarlet Local AI UI",
          short_name: "Escarlet Local AI UI",
          description: "Private remote interface for local AI models",
          theme_color: "#0b0f19",
          background_color: "#0b0f19",
          display: "standalone",
          start_url: "/",
          icons: [
            { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      port: 5173,
      host: true,
      proxy: {
        "/api": {
          target: env.VITE_SERVER_URL || "http://127.0.0.1:3000",
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
