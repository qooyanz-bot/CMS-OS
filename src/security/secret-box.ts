import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const algorithm = "aes-256-gcm";

function deriveKey(key: string): Buffer {
  if (key.length < 32) throw new Error("CMS_OS_AUTH_ENCRYPTION_KEYは32文字以上で指定してください。");
  return createHash("sha256").update(key, "utf8").digest();
}

export function sealSecret(value: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, deriveKey(key), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export function openSecret(value: string, key: string): string {
  const [version, ivHex, tagHex, ciphertextHex] = value.split(":");
  if (version !== "v1" || !ivHex || !tagHex || !ciphertextHex) throw new Error("暗号化された認証情報の形式が不正です。");
  const decipher = createDecipheriv(algorithm, deriveKey(key), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextHex, "hex")), decipher.final()]).toString("utf8");
}
