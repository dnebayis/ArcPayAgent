import { Store } from "./base";

export interface VendorData {
    address: string;
    displayName: string;
    totalPaid: number;
    paymentCount: number;
    lastPayment?: number;
}

const NS = "vendors";

export class VendorStore {
    constructor(private store: Store) {}

    async saveVendor(chatId: number, name: string, address: string): Promise<void> {
        const all = await this.getAll(chatId);
        const key = name.toLowerCase();
        const existing = all[key];
        all[key] = {
            address,
            displayName: name,
            totalPaid: existing?.totalPaid ?? 0,
            paymentCount: existing?.paymentCount ?? 0,
            lastPayment: existing?.lastPayment,
        };
        await this.store.set(NS, String(chatId), all);
    }

    async getVendor(chatId: number, name: string): Promise<VendorData | null> {
        const all = await this.getAll(chatId);
        return all[name.toLowerCase()] ?? null;
    }

    async findVendor(chatId: number, query: string): Promise<{ name: string; data: VendorData } | null> {
        const all = await this.getAll(chatId);
        const q = query.toLowerCase();

        // Exact match first
        if (all[q]) return { name: q, data: all[q] };

        // Fuzzy match
        let best: { name: string; data: VendorData; score: number } | null = null;
        for (const [name, data] of Object.entries(all)) {
            const score = bigramSimilarity(q, name);
            if (score >= 0.5 && (!best || score > best.score)) {
                best = { name, data, score };
            }
        }
        return best ? { name: best.name, data: best.data } : null;
    }

    async listVendors(chatId: number): Promise<Record<string, VendorData>> {
        return this.getAll(chatId);
    }

    async removeVendor(chatId: number, name: string): Promise<boolean> {
        const all = await this.getAll(chatId);
        const key = name.toLowerCase();
        if (!all[key]) return false;
        delete all[key];
        await this.store.set(NS, String(chatId), all);
        return true;
    }

    async removeAll(chatId: number): Promise<number> {
        const all = await this.getAll(chatId);
        const count = Object.keys(all).length;
        await this.store.set(NS, String(chatId), {});
        return count;
    }

    async recordPayment(chatId: number, name: string, amount: number): Promise<void> {
        const all = await this.getAll(chatId);
        const key = name.toLowerCase();
        const v = all[key];
        if (!v) return;
        v.totalPaid = (v.totalPaid || 0) + amount;
        v.paymentCount = (v.paymentCount || 0) + 1;
        v.lastPayment = Date.now();
        await this.store.set(NS, String(chatId), all);
    }

    async getTopVendors(chatId: number, limit = 5): Promise<Array<{ name: string; data: VendorData }>> {
        const all = await this.getAll(chatId);
        return Object.entries(all)
            .map(([name, data]) => ({ name, data }))
            .sort((a, b) => (b.data.totalPaid || 0) - (a.data.totalPaid || 0))
            .slice(0, limit);
    }

    private async getAll(chatId: number): Promise<Record<string, VendorData>> {
        return (await this.store.get<Record<string, VendorData>>(NS, String(chatId))) ?? {};
    }
}

function bigrams(str: string): Set<string> {
    const s = new Set<string>();
    for (let i = 0; i < str.length - 1; i++) s.add(str.slice(i, i + 2));
    return s;
}

function bigramSimilarity(a: string, b: string): number {
    const ba = bigrams(a);
    const bb = bigrams(b);
    if (ba.size === 0 && bb.size === 0) return a === b ? 1 : 0;
    let intersection = 0;
    for (const bg of ba) if (bb.has(bg)) intersection++;
    return (2 * intersection) / (ba.size + bb.size);
}
