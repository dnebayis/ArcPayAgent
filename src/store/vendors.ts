import { DB } from "./db";

export interface VendorData {
    address: string;
    displayName: string;
    totalPaid: number;
    paymentCount: number;
    lastPayment?: number;
}

export class VendorStore {
    constructor(private db: DB) {}

    async saveVendor(chatId: number, name: string, address: string): Promise<void> {
        const key = name.toLowerCase();
        await this.db.run(
            `INSERT INTO vendors (chat_id,name,display_name,address,total_paid,payment_count)
             VALUES ($1,$2,$3,$4,0,0)
             ON CONFLICT (chat_id,name) DO UPDATE SET display_name=$3, address=$4`,
            [chatId, key, name, address]
        );
    }

    async getVendor(chatId: number, name: string): Promise<VendorData | null> {
        const row = await this.db.queryOne<any>(
            "SELECT * FROM vendors WHERE chat_id=$1 AND name=$2", [chatId, name.toLowerCase()]
        );
        return row ? rowToVendor(row) : null;
    }

    async findVendor(chatId: number, query: string): Promise<{ name: string; data: VendorData } | null> {
        const all = await this.listVendors(chatId);
        const q = query.toLowerCase();
        if (all[q]) return { name: q, data: all[q] };

        let best: { name: string; data: VendorData; score: number } | null = null;
        for (const [name, data] of Object.entries(all)) {
            const score = bigramSimilarity(q, name);
            if (score >= 0.5 && (!best || score > best.score)) best = { name, data, score };
        }
        return best ? { name: best.name, data: best.data } : null;
    }

    async listVendors(chatId: number): Promise<Record<string, VendorData>> {
        const rows = await this.db.query<any>("SELECT * FROM vendors WHERE chat_id=$1", [chatId]);
        const result: Record<string, VendorData> = {};
        for (const row of rows) result[row.name] = rowToVendor(row);
        return result;
    }

    async removeVendor(chatId: number, name: string): Promise<boolean> {
        const row = await this.db.queryOne<any>(
            "SELECT 1 FROM vendors WHERE chat_id=$1 AND name=$2", [chatId, name.toLowerCase()]
        );
        if (!row) return false;
        await this.db.run("DELETE FROM vendors WHERE chat_id=$1 AND name=$2", [chatId, name.toLowerCase()]);
        return true;
    }

    async removeAll(chatId: number): Promise<number> {
        const rows = await this.db.query<any>(
            "SELECT count(*) as cnt FROM vendors WHERE chat_id=$1", [chatId]
        );
        const count = Number(rows[0]?.cnt ?? 0);
        await this.db.run("DELETE FROM vendors WHERE chat_id=$1", [chatId]);
        return count;
    }

    async recordPayment(chatId: number, name: string, amount: number): Promise<void> {
        await this.db.run(
            `UPDATE vendors SET total_paid=total_paid+$1, payment_count=payment_count+1, last_payment=$2
             WHERE chat_id=$3 AND name=$4`,
            [amount, Date.now(), chatId, name.toLowerCase()]
        );
    }

    async getTopVendors(chatId: number, limit = 5): Promise<Array<{ name: string; data: VendorData }>> {
        const rows = await this.db.query<any>(
            "SELECT * FROM vendors WHERE chat_id=$1 ORDER BY total_paid DESC LIMIT $2",
            [chatId, limit]
        );
        return rows.map(row => ({ name: row.name, data: rowToVendor(row) }));
    }
}

function rowToVendor(row: any): VendorData {
    return {
        address: row.address,
        displayName: row.display_name,
        totalPaid: Number(row.total_paid),
        paymentCount: Number(row.payment_count),
        lastPayment: row.last_payment ? Number(row.last_payment) : undefined,
    };
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
