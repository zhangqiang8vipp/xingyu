import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json" with { type: "json" };
import { sites } from "./plugins/sites-vite-plugin.ts";

const DEVELOPMENT_DATABASE_ID = "4e2a8280-5a0f-4534-bee6-4329ff16231a";
const PRODUCTION_PREVIEW_DATABASE_ID = "6c4a3215-cbe7-426e-bfef-17acc33db39a";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig(async ({ command, mode }) => {
  const appEnvironment = command === "build" || mode === "production" ? "production" : "development";
  const localBindingConfig = {
    main: "./worker/index.ts",
    compatibility_flags: ["nodejs_compat"],
    vars: {
      APP_ENV: appEnvironment,
      DB_SCHEMA_MODE: "migration-only",
    },
    d1_databases: d1
      ? [
          {
            binding: d1,
            database_name: appEnvironment === "development" ? "xingyu-development-v2" : "xingyu-production-preview-v2",
            database_id: appEnvironment === "development"
              ? DEVELOPMENT_DATABASE_ID
              : PRODUCTION_PREVIEW_DATABASE_ID,
          },
        ]
      : [],
    r2_buckets: r2
      ? [
          {
            binding: r2,
            bucket_name: appEnvironment === "development" ? "xingyu-development-media" : "xingyu-production-preview-media",
          },
        ]
      : [],
  };

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      host: "127.0.0.1",
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      {
        name: "xingyu-katex-font-display",
        enforce: "pre",
        transform(code: string, id: string) {
          if (!id.includes("katex/dist/katex.min.css")) return null;
          return code.replaceAll("font-display:block", "font-display:swap");
        },
      },
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
