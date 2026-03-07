import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";

export class KeyVault {
    static encryptPrivateKey(privateKey: string, secret: string): string {
        const key = crypto.createHash("sha256").update(secret).digest();
        const iv = crypto.randomBytes(12);

        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

        let encrypted = cipher.update(privateKey, "utf8", "hex");
        encrypted += cipher.final("hex");

        const authTag = cipher.getAuthTag().toString("hex");

        return `${iv.toString("hex")}:${authTag}:${encrypted}`;
    }

    static decryptPrivateKey(encryptedData: string, secret: string): string {
        const key = crypto.createHash("sha256").update(secret).digest();

        const parts = encryptedData.split(":");
        if (parts.length !== 3) {
            throw new Error("Invalid encrypted data format");
        }

        const iv = Buffer.from(parts[0], "hex");
        const authTag = Buffer.from(parts[1], "hex");
        const encrypted = parts[2];

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encrypted, "hex", "utf8");
        decrypted += decipher.final("utf8");

        return decrypted;
    }
}
