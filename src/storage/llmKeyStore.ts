import { KeyVault } from "../security/keyVault";
import { loadStore, saveStore } from "./persistence";

const LLM_FILE = "llmkeys.json";

export interface LLMMetadata {
    provider: string;
    encryptedKey: string;
    model?: string;
}

export class LLMKeyStore {
    private store: Record<string, LLMMetadata>;

    constructor(private llmSecret: string) {
        if (!llmSecret) {
            throw new Error("LLM_KEY_SECRET is not defined");
        }
        this.store = loadStore<Record<string, LLMMetadata>>(LLM_FILE);
    }

    private persist(): void {
        saveStore(LLM_FILE, this.store);
    }

    private tryDecrypt(metadata: LLMMetadata): string | null {
        try {
            return KeyVault.decryptPrivateKey(metadata.encryptedKey, this.llmSecret);
        } catch (error) {
            console.warn("[LLMKeyStore] Stored LLM key could not be decrypted. The user should set it again.", error);
            return null;
        }
    }

    setKey(chatId: string | number, provider: string, key: string): void {
        const id = chatId.toString();
        const encryptedKey = KeyVault.encryptPrivateKey(key, this.llmSecret);
        this.store[id] = { provider: provider.toLowerCase(), encryptedKey };
        this.persist();
    }

    getKey(chatId: string | number): { provider: string; key: string; model?: string } | null {
        const id = chatId.toString();
        const metadata = this.store[id];
        if (!metadata) return null;

        const decryptedKey = this.tryDecrypt(metadata);
        if (!decryptedKey) {
            return null;
        }

        return {
            provider: metadata.provider,
            key: decryptedKey,
            model: metadata.model
        };
    }

    setModel(chatId: string | number, model: string): boolean {
        const id = chatId.toString();
        if (this.store[id]) {
            this.store[id].model = model;
            this.persist();
            return true;
        }
        return false;
    }

    removeKey(chatId: string | number): boolean {
        const id = chatId.toString();
        if (this.store[id]) {
            delete this.store[id];
            this.persist();
            return true;
        }
        return false;
    }

    hasKey(chatId: string | number): boolean {
        const metadata = this.store[chatId.toString()];
        if (!metadata) return false;
        return this.tryDecrypt(metadata) !== null;
    }

    getStatus(chatId: string | number): string {
        const id = chatId.toString();
        const metadata = this.store[id];
        if (!metadata) return "No LLM key configured.";
        if (!this.tryDecrypt(metadata)) {
            return "LLM key is configured but invalid for the current encryption secret. Please set it again.";
        }
        const modelStr = metadata.model ? ` (model: ${metadata.model})` : "";
        return `LLM key configured for provider: ${metadata.provider}${modelStr}`;
    }
}
