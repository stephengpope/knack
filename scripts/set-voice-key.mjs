// One-off: encrypt + store the AssemblyAI key in app_settings (singleton "app").
// Run: pnpm dlx dotenv-cli -e .env.local -- node scripts/set-voice-key.mjs <key>
import crypto from "node:crypto";
import { neon } from "@neondatabase/serverless";

const raw = process.argv[2];
if (!raw) throw new Error("usage: node set-voice-key.mjs <api-key>");

const keyBuf = Buffer.from(process.env.ENCRYPTION_KEY, "base64");
if (keyBuf.length !== 32) throw new Error("ENCRYPTION_KEY must decode to 32 bytes");

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuf, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ct].map((b) => b.toString("base64")).join(":");
}

const value = raw.trim();
const enc = encrypt(value);
const last4 = value.slice(-4);

const sql = neon(process.env.DATABASE_URL);
await sql`
  INSERT INTO app_settings (id, assemblyai_key, assemblyai_key_last4, updated_at)
  VALUES ('app', ${enc}, ${last4}, now())
  ON CONFLICT (id) DO UPDATE
    SET assemblyai_key = ${enc}, assemblyai_key_last4 = ${last4}, updated_at = now()
`;
console.log(`Stored AssemblyAI key (••••${last4}).`);
