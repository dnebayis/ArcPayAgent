import { Store } from "./base";
import { encrypt, decrypt } from "../security/vault";
import { logger } from "../utils/logger";

interface LLMKeyData {
    provider: string;
    encryptedKey: string;
    model?: string;
}

const NS = "llm_keys";

export class LLMKeyStore {
    constructor(private store: Store, private secret: string) {}

    async getKey(chatId: number): Promise<{ provider: string; key: string; model?: string } | null> {
        const data = await this.store.get<LLMKeyData>(NS, String(chatId));
        if (!data) return null;
        try {
            const key = decrypt(data.encryptedKey, this.secret);
            return { provider: data.provider, key, model: data.model };
        } catch (err: any) {
            logger.error(chatId, "[KeyStore] Decryption failed — LLM_KEY_SECRET may have changed", { error: err?.message });
            return null;
        }
    }

    async setKey(chatId: number, provider: string, apiKey: string, model?: string): Promise<void> {
        const encryptedKey = encrypt(apiKey, this.secret);
        await this.store.set(NS, String(chatId), { provider, encryptedKey, model } satisfies LLMKeyData);
    }

    async removeKey(chatId: number): Promise<void> {
        await this.store.delete(NS, String(chatId));
    }

    async hasKey(chatId: number): Promise<boolean> {
        return !!(await this.store.get(NS, String(chatId)));
    }

    async setModel(chatId: number, model: string): Promise<boolean> {
        const data = await this.store.get<LLMKeyData>(NS, String(chatId));
        if (!data) return false;
        data.model = model;
        await this.store.set(NS, String(chatId), data);
        return true;
    }

    async setProvider(chatId: number, provider: string): Promise<boolean> {
        const data = await this.store.get<LLMKeyData>(NS, String(chatId));
        if (!data) return false;
        data.provider = provider;
        await this.store.set(NS, String(chatId), data);
        return true;
    }

    async getInfo(chatId: number): Promise<{ provider: string; model?: string } | null> {
        const data = await this.store.get<LLMKeyData>(NS, String(chatId));
        if (!data) return null;
        return { provider: data.provider, model: data.model };
    }

    async getAuth(chatId: number): Promise<{ provider: string; key: string; model?: string } | null> {
        return this.getKey(chatId);
    }
}
