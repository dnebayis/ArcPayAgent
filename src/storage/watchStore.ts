import { loadStore, saveStore } from "./persistence";

export interface WatchSettings {
    chatId: number;
    walletAddress: string;
    lastKnownUsdcBalance: string; // BigInt stored as string
    lastKnownEurcBalance: string;
    enabled: boolean;
    enabledAt: number;
}

type WatchData = Record<string, WatchSettings>; // key: chatId.toString()

const FILENAME = "watch_settings";

export class WatchStore {
    private data: WatchData = {};

    constructor() {
        this.data = loadStore<WatchData>(FILENAME) || {};
    }

    private persist(): void {
        saveStore(FILENAME, this.data);
    }

    enable(chatId: number, walletAddress: string, initialUsdcBalance: string, initialEurcBalance: string): void {
        this.data[chatId.toString()] = {
            chatId,
            walletAddress,
            lastKnownUsdcBalance: initialUsdcBalance,
            lastKnownEurcBalance: initialEurcBalance,
            enabled: true,
            enabledAt: Date.now()
        };
        this.persist();
    }

    disable(chatId: number): boolean {
        const entry = this.data[chatId.toString()];
        if (!entry) return false;
        entry.enabled = false;
        this.persist();
        return true;
    }

    isEnabled(chatId: number): boolean {
        return this.data[chatId.toString()]?.enabled ?? false;
    }

    getSettings(chatId: number): WatchSettings | null {
        return this.data[chatId.toString()] ?? null;
    }

    getAllEnabled(): WatchSettings[] {
        return Object.values(this.data).filter(s => s.enabled);
    }

    updateBalances(chatId: number, usdcBalance: string, eurcBalance: string): void {
        const entry = this.data[chatId.toString()];
        if (!entry) return;
        entry.lastKnownUsdcBalance = usdcBalance;
        entry.lastKnownEurcBalance = eurcBalance;
        this.persist();
    }
}
