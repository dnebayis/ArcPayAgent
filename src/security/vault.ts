import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Derive a 32-byte key from a secret string.
 */
function deriveKey(secret: string): Buffer {
    return Buffer.from(secret.padEnd(32, "0").slice(0, 32), "utf-8");
}

/**
 * Encrypt a plaintext value. Returns "iv:tag:ciphertext" (all hex).
 */
export function encrypt(plaintext: string, secret: string): string {
    const key = deriveKey(secret);
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt a value produced by encrypt().
 */
export function decrypt(encryptedData: string, secret: string): string {
    const key = deriveKey(secret);
    const [ivHex, tagHex, dataHex] = encryptedData.split(":");
    if (!ivHex || !tagHex || !dataHex) throw new Error("Invalid encrypted data format");
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const data = Buffer.from(dataHex, "hex");
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf-8");
}
