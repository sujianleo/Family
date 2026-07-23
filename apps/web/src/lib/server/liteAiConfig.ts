import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { isLiteBackend } from "./familyBackend";
import { getLiteDatabase } from "./liteDatabase";

export type LiteAiConfig = {
  apiKey: string;
  deepModel: string;
  endpoint: string;
  fastModel: string;
};

type EncryptedValue = {
  authTag: string;
  ciphertext: string;
  iv: string;
  version: 1;
};

const settingKey = "ai.deepseek";
const officialEndpoint = "https://api.deepseek.com";

export function saveLiteAiConfig(config: LiteAiConfig) {
  if (!isLiteBackend()) return;
  const normalized: LiteAiConfig = {
    apiKey: config.apiKey.trim(),
    deepModel: config.deepModel.trim() || "deepseek-v4-pro",
    endpoint: officialEndpoint,
    fastModel: config.fastModel.trim() || "deepseek-v4-flash"
  };
  if (!normalized.apiKey) throw new Error("DeepSeek API Key 不能为空。");
  const encrypted = encrypt(JSON.stringify(normalized));
  getLiteDatabase().prepare(`
    insert into lite_settings(key, value_json, updated_at)
    values (?, ?, ?)
    on conflict(key) do update set value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run(settingKey, JSON.stringify(encrypted), new Date().toISOString());
}

export function readLiteAiConfig(): LiteAiConfig | null {
  if (!isLiteBackend()) return null;
  const row = getLiteDatabase().prepare("select value_json from lite_settings where key = ?")
    .get(settingKey) as { value_json: string } | undefined;
  if (!row) return null;
  try {
    const encrypted = JSON.parse(row.value_json) as EncryptedValue;
    const parsed = JSON.parse(decrypt(encrypted)) as Partial<LiteAiConfig>;
    if (!parsed.apiKey?.trim()) return null;
    return {
      apiKey: parsed.apiKey.trim(),
      deepModel: parsed.deepModel?.trim() || "deepseek-v4-pro",
      endpoint: officialEndpoint,
      fastModel: parsed.fastModel?.trim() || "deepseek-v4-flash"
    };
  } catch {
    return null;
  }
}

function encrypt(value: string): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    version: 1
  };
}

function decrypt(value: EncryptedValue) {
  if (value.version !== 1) throw new Error("不支持的 Lite 设置版本。");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
}

function encryptionKey() {
  const secret = process.env.FAMILY_APP_LOCAL_AUTH_SESSION_SECRET?.trim();
  if (!secret) throw new Error("Lite 会话密钥尚未配置。");
  return createHash("sha256").update(`family-lite-ai:${secret}`).digest();
}
