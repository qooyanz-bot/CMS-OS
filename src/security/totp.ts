import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function encodeBase32(value: Buffer): string {
  let bits = 0;
  let buffer = 0;
  let output = "";
  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += base32Alphabet[(buffer >>> bits) & 31];
      buffer &= bits === 0 ? 0 : (1 << bits) - 1;
    }
  }
  if (bits > 0) output += base32Alphabet[(buffer << (5 - bits)) & 31];
  return output;
}

function decodeBase32(value: string): Buffer {
  const normalized = value.toUpperCase().replace(/=+$/g, "");
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    const index = base32Alphabet.indexOf(character);
    if (index < 0) throw new Error("MFAシークレットの形式が不正です。");
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 255);
      buffer &= bits === 0 ? 0 : (1 << bits) - 1;
    }
  }
  return Buffer.from(bytes);
}

function createTotpCode(secret: string, counter: bigint): string {
  const key = decodeBase32(secret);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", key).update(counterBuffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24)
    | ((digest[offset + 1]! & 0xff) << 16)
    | ((digest[offset + 2]! & 0xff) << 8)
    | (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function createTotpUri(secret: string, issuer: string, account: string): string {
  const label = `${issuer}:${account}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

export function verifyTotp(secret: string, code: string, now = Date.now(), window = 1): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const counter = BigInt(Math.floor(now / 30_000));
  const supplied = Buffer.from(code, "ascii");
  for (let offset = -window; offset <= window; offset += 1) {
    const candidateCounter = counter + BigInt(offset);
    if (candidateCounter < 0n) continue;
    const expected = Buffer.from(createTotpCode(secret, candidateCounter), "ascii");
    if (timingSafeEqual(supplied, expected)) return true;
  }
  return false;
}
