import { Store } from "./base";

export interface VendorData {
    address: string;
    displayName: string;
    totalPaid: number;
    paymentCount: number;
    lastPayment?: number;
}

const NS = "vendors";

/** Compound row key: "{chatId}:{vendorName}" */
const rowKey = (chatId: number, name: string) => `${chatId}:${name}`;

export class VendorStore {
    /**
     * Namespace : vendors
     * Key pattern: {chatId}:{vendorName}  (vendorName is lowercased)
     * Value type : VendorData
     */
    constructor(private store: Store) {}

    async saveVendor(chatId: number, name: string, address: string): Promise<void> {
        const key = name.toLowerCase();
        const existing = await this.store.get<VendorData>(NS, rowKey(chatId, key));
        const vendor: VendorData = {
            address,
            displayName: name,
            totalPaid: existing?.totalPaid ?? 0,
            paymentCount: existing?.paymentCount ?? 0,
            lastPayment: existing?.lastPayment,
        };
        await this.store.set(NS, rowKey(chatId, key), vendor);
    }

    async getVendor(chatId: number, name: string): Promise<VendorData | null> {
        return this.store.get<VendorData>(NS, rowKey(chatId, name.toLowerCase()));
    }

    async findVendor(chatId: number, query: string): Promise<{ name: string; data: VendorData } | null> {
        const all = await this.listVendors(chatId);
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
        const prefix = `${chatId}:`;
        const raw = await this.store.getByPrefix<VendorData>(NS, prefix);
        const result: Record<string, VendorData> = {};
        for (const [k, v] of Object.entries(raw)) {
            result[k.slice(prefix.length)] = v;
        }
        return result;
    }

    async removeVendor(chatId: number, name: string): Promise<boolean> {
        const key = name.toLowerCase();
        const existing = await this.store.get<VendorData>(NS, rowKey(chatId, key));
        if (!existing) return false;
        await this.store.delete(NS, rowKey(chatId, key));
        return true;
    }

    async removeAll(chatId: number): Promise<number> {
        const all = await this.listVendors(chatId);
        const count = Object.keys(all).length;
        for (const name of Object.keys(all)) {
            await this.store.delete(NS, rowKey(chatId, name));
        }
        return count;
    }

    async recordPayment(chatId: number, name: string, amount: number): Promise<void> {
        const key = name.toLowerCase();
        const v = await this.store.get<VendorData>(NS, rowKey(chatId, key));
        if (!v) return;
        v.totalPaid = (v.totalPaid || 0) + amount;
        v.paymentCount = (v.paymentCount || 0) + 1;
        v.lastPayment = Date.now();
        await this.store.set(NS, rowKey(chatId, key), v);
    }

    async getTopVendors(chatId: number, limit = 5): Promise<Array<{ name: string; data: VendorData }>> {
        const all = await this.listVendors(chatId);
        return Object.entries(all)
            .map(([name, data]) => ({ name, data }))
            .sort((a, b) => (b.data.totalPaid || 0) - (a.data.totalPaid || 0))
            .slice(0, limit);
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
