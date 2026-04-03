import { DB } from "./db";
import { encrypt, decrypt } from "../security/vault";
import { logger } from "../utils/logger";

export class LLMKeyStore {
    constructor(private db: DB, private secret: string) {}

    async getKey(chatId: number): Promise<{ provider: string; key: string; model?: string } | null> {
        const row = await this.db.queryOne<any>("SELECT * FROM llm_keys WHERE chat_id=$1", [chatId]);
        if (!row) return null;
        try {
            const key = decrypt(row.encrypted_key, this.secret);
            return { provider: row.provider, key, model: row.model ?? undefined };
        } catch (err: any) {
            logger.error(chatId, "[KeyStore] Decryption failed — LLM_KEY_SECRET may have changed", { error: err?.message });
            return null;
        }
    }

    async setKey(chatId: number, provider: string, apiKey: string, model?: string): Promise<void> {
        const encryptedKey = encrypt(apiKey, this.secret);
        await this.db.run(
            `INSERT INTO llm_keys (chat_id,provider,encrypted_key,model) VALUES ($1,$2,$3,$4)
             ON CONFLICT (chat_id) DO UPDATE SET provider=$2,encrypted_key=$3,model=$4`,
            [chatId, provider, encryptedKey, model ?? null]
        );
    }

    async removeKey(chatId: number): Promise<void> {
        await this.db.run("DELETE FROM llm_keys WHERE chat_id=$1", [chatId]);
    }

    async hasKey(chatId: number): Promise<boolean> {
        return !!(await this.db.queryOne("SELECT 1 FROM llm_keys WHERE chat_id=$1", [chatId]));
    }

    async setModel(chatId: number, model: string): Promise<boolean> {
        if (!(await this.hasKey(chatId))) return false;
        await this.db.run("UPDATE llm_keys SET model=$1 WHERE chat_id=$2", [model, chatId]);
        return true;
    }

    async setProvider(chatId: number, provider: string): Promise<boolean> {
        if (!(await this.hasKey(chatId))) return false;
        await this.db.run("UPDATE llm_keys SET provider=$1 WHERE chat_id=$2", [provider, chatId]);
        return true;
    }

    async getInfo(chatId: number): Promise<{ provider: string; model?: string } | null> {
        const row = await this.db.queryOne<any>(
            "SELECT provider, model FROM llm_keys WHERE chat_id=$1", [chatId]
        );
        return row ? { provider: row.provider, model: row.model ?? undefined } : null;
    }

    async getAuth(chatId: number): Promise<{ provider: string; key: string; model?: string } | null> {
        return this.getKey(chatId);
    }
}
