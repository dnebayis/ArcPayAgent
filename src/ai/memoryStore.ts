import path from 'path';
import { loadStore, saveStore } from "../storage/persistence";

export interface PaymentPattern {
    vendor: string;
    amount: number;
    timestamp: number;
}

export interface InvoicePattern {
    vendor: string;
    amount: number;
    timestamp: number;
}

export interface UserMemory {
    chatId: number;
    favoriteVendors: Record<string, number>; // vendor name -> count
    recentPayments: PaymentPattern[];
    recentInvoices: InvoicePattern[];
}

export class MemoryStore {
    private storeName: string;
    private memories: Record<string, UserMemory> = {};

    constructor(dataPath: string = path.join(process.cwd(), "data", "memory.json")) {
        this.storeName = this.resolveStoreName(dataPath);
        this.load();
    }

    private resolveStoreName(dataPath: string): string {
        const defaultDataDir = path.join(process.cwd(), "data");

        if (!path.isAbsolute(dataPath)) {
            return dataPath;
        }

        const relativePath = path.relative(defaultDataDir, dataPath);
        if (relativePath && !relativePath.startsWith("..")) {
            return relativePath;
        }

        return path.basename(dataPath);
    }

    private load() {
        try {
            this.memories = loadStore<Record<string, UserMemory>>(this.storeName);
        } catch (e) {
            console.error("Failed to load memory store", e);
            this.memories = {};
        }
    }

    private save() {
        try {
            saveStore(this.storeName, this.memories);
        } catch (e) {
            console.error("Failed to save memory store", e);
        }
    }

    private ensure(chatId: number): UserMemory {
        const id = chatId.toString();
        if (!this.memories[id]) {
            this.memories[id] = { chatId, favoriteVendors: {}, recentPayments: [], recentInvoices: [] };
        }
        return this.memories[id];
    }

    recordVendorAdded(chatId: number, name: string) {
        const memory = this.ensure(chatId);
        const lowerName = name.toLowerCase();
        memory.favoriteVendors[lowerName] = (memory.favoriteVendors[lowerName] || 0) + 1;
        this.save();
    }

    recordPayment(chatId: number, vendor: string | null, amount: number) {
        if (!vendor) return;
        const memory = this.ensure(chatId);
        const lowerName = vendor.toLowerCase();

        memory.favoriteVendors[lowerName] = (memory.favoriteVendors[lowerName] || 0) + 1;

        memory.recentPayments.push({ vendor: lowerName, amount, timestamp: Date.now() });
        // Keep only last 10
        if (memory.recentPayments.length > 10) {
            memory.recentPayments.shift();
        }

        this.save();
    }

    recordInvoice(chatId: number, vendor: string, amount: number) {
        const memory = this.ensure(chatId);
        const lowerName = vendor.toLowerCase();

        memory.recentInvoices.push({ vendor: lowerName, amount, timestamp: Date.now() });
        // Keep only last 20
        if (memory.recentInvoices.length > 20) {
            memory.recentInvoices.shift();
        }

        this.save();
    }

    getMemorySummary(chatId: number): string {
        const id = chatId.toString();
        if (!this.memories[id]) return "";

        const memory = this.memories[id];
        let summary = "USER MEMORY & TRADING PATTERNS:\n";

        const topVendors = Object.entries(memory.favoriteVendors)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(e => e[0]);

        if (topVendors.length > 0) {
            summary += `- Top Vendors: ${topVendors.join(", ")}\n`;
        }

        if (memory.recentPayments.length > 0) {
            const total = memory.recentPayments.reduce((sum, p) => sum + p.amount, 0);
            const avg = total / memory.recentPayments.length;
            summary += `- Average Payment: ${avg.toFixed(2)} USDC\n`;
            summary += `- Recent Payments: ${memory.recentPayments.slice(-3).map(p => p.amount + " USDC to " + p.vendor).join(", ")}\n`;
        }

        if (memory.recentInvoices.length > 0) {
            summary += `- Recent Invoices: ${memory.recentInvoices.slice(-3).map(i => i.amount + " USDC from " + i.vendor).join(", ")}\n`;
        }

        return summary;
    }

    getRecentInvoiceByVendor(chatId: number, vendor: string): InvoicePattern | null {
        const memory = this.ensure(chatId);
        const lowerName = vendor.toLowerCase();
        const matches = memory.recentInvoices.filter(i => i.vendor === lowerName);
        if (matches.length > 0) {
            return matches[matches.length - 1]; // return the latest
        }
        return null; // or null if empty
    }

    getAveragePayment(chatId: number, vendor: string): number | null {
        const memory = this.ensure(chatId);
        const lowerName = vendor.toLowerCase();
        const matches = memory.recentPayments.filter(p => p.vendor === lowerName);
        if (matches.length > 0) {
            const sum = matches.reduce((acc, p) => acc + p.amount, 0);
            return sum / matches.length;
        }
        return null;
    }

    getLastInvoice(chatId: number): InvoicePattern | null {
        const memory = this.ensure(chatId);
        if (memory.recentInvoices.length > 0) {
            return memory.recentInvoices[memory.recentInvoices.length - 1];
        }
        return null;
    }

    getLastPayment(chatId: number): PaymentPattern | null {
        const memory = this.ensure(chatId);
        if (memory.recentPayments.length > 0) {
            return memory.recentPayments[memory.recentPayments.length - 1];
        }
        return null;
    }
}
