import { env } from "cloudflare:workers";
import { ensureDatabase } from "@/db/bootstrap";
import {
  DEFAULT_QA_MODEL_CONFIG,
  parseQaModelConfig,
  type QaModelConfig,
} from "@/server/qa-openrouter";

const CONFIG_KEY = "qa:runtime-config:v1";

export async function getQaModelConfig(): Promise<QaModelConfig> {
  await ensureDatabase();
  const row=await env.DB.prepare("SELECT value FROM app_meta WHERE key=?")
    .bind(CONFIG_KEY).first<{value:string}>();
  if(!row) return {...DEFAULT_QA_MODEL_CONFIG};
  try {
    return parseQaModelConfig(JSON.parse(row.value));
  } catch {
    // Never propagate corrupted database configuration into model requests.
    console.error("knowledge_qa_model_config_invalid");
    return {...DEFAULT_QA_MODEL_CONFIG};
  }
}

export async function saveQaModelConfig(input: unknown): Promise<QaModelConfig> {
  // Validate before writing; there is no API key or private document content
  // in this persisted JSON value.
  const config=parseQaModelConfig(input);
  await ensureDatabase();
  await env.DB.prepare(
    "INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
  ).bind(CONFIG_KEY,JSON.stringify(config)).run();
  return config;
}
