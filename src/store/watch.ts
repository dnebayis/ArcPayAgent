import { Store } from "./base";

export interface WatchConfig {
    enabled: boolean;
    walletAddress: string;
    lastUsdcBalance: string;
    lastEurcBalance: string;
    enabledAt: number;
}

const NS = "watch";

export class WatchStore {
    constructor(private store: Store) {}

    async enable(chatId: number, walletAddress: string): Promise<void> {
        await this.store.set(NS, String(chatId), {
            enabled: true,
            walletAddress,
            lastUsdcBalance: "0",
            lastEurcBalance: "0",
            enabledAt: Date.now(),
        } satisfies WatchConfig);
    }

    async disable(chatId: number): Promise<void> {
        const cfg = await this.getConfig(chatId);
        if (cfg) { cfg.enabled = false; await this.store.set(NS, String(chatId), cfg); }
    }

    async isEnabled(chatId: number): Promise<boolean> {
        const cfg = await this.getConfig(chatId);
        return cfg?.enabled ?? false;
    }

    async getConfig(chatId: number): Promise<WatchConfig | null> {
        return this.store.get<WatchConfig>(NS, String(chatId));
    }

    async updateBalances(chatId: number, usdc: string, eurc: string): Promise<void> {
        const cfg = await this.getConfig(chatId);
        if (cfg) {
            cfg.lastUsdcBalance = usdc;
            cfg.lastEurcBalance = eurc;
            await this.store.set(NS, String(chatId), cfg);
        }
    }

    async getAllEnabled(): Promise<Array<{ chatId: number; config: WatchConfig }>> {
        const all = await this.store.getAll<WatchConfig>(NS);
        const result: Array<{ chatId: number; config: WatchConfig }> = [];
        for (const [chatIdStr, cfg] of Object.entries(all)) {
            if (cfg.enabled) result.push({ chatId: parseInt(chatIdStr, 10), config: cfg });
        }
        return result;
    }
}
