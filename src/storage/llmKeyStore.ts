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

        return {
            provider: metadata.provider,
            key: KeyVault.decryptPrivateKey(metadata.encryptedKey, this.llmSecret),
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
        return !!this.store[chatId.toString()];
    }

    getStatus(chatId: string | number): string {
        const id = chatId.toString();
        const metadata = this.store[id];
        if (!metadata) return "No LLM key configured.";
        const modelStr = metadata.model ? ` (model: ${metadata.model})` : "";
        return `LLM key configured for provider: ${metadata.provider}${modelStr}`;
    }
}
