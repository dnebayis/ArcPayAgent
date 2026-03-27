import { loadStore, saveStore } from "./persistence";

const VENDOR_FILE = "vendors.json";

export interface VendorData {
    address: string;
    displayName?: string;
    totalPaid: number;
    invoiceCount: number;
    lastPayment: number | null;
    lastInvoice: number | null;
}

export interface UserVendors {
    vendors: Record<string, VendorData>;
}

export interface VendorMatch {
    name: string;
    data: VendorData;
}

export class VendorStore {
    private store: Record<string, UserVendors>;

    constructor() {
        const raw = loadStore<Record<string, any>>(VENDOR_FILE);
        // Migration: convert old string-only format to new VendorData format
        this.store = this.migrateStore(raw);
    }

    /**
     * Migrate old format { vendors: { "jack": "0x..." } }
     * to new format { vendors: { "jack": { address: "0x...", totalPaid: 0, ... } } }
     */
    private migrateStore(raw: Record<string, any>): Record<string, UserVendors> {
        const migrated: Record<string, UserVendors> = {};

        for (const [chatId, userData] of Object.entries(raw)) {
            if (!userData || !userData.vendors) {
                migrated[chatId] = { vendors: {} };
                continue;
            }

            const vendors: Record<string, VendorData> = {};
            for (const [name, value] of Object.entries(userData.vendors)) {
                if (typeof value === "string") {
                    // Old format — migrate
                    vendors[name] = {
                        address: value,
                        displayName: name,
                        totalPaid: 0,
                        invoiceCount: 0,
                        lastPayment: null,
                        lastInvoice: null
                    };
                } else if (typeof value === "object" && value !== null && (value as any).address) {
                    // New format — keep as is
                    vendors[name] = {
                        displayName: name,
                        ...(value as VendorData)
                    };
                }
            }
            migrated[chatId] = { vendors };
        }

        return migrated;
    }

    private persist(): void {
        saveStore(VENDOR_FILE, this.store);
    }

    private normalizeVendorName(name: string): string {
        return name
            .toLowerCase()
            .trim()
            .replace(/['"`]/g, "")
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
    }

    private collapseVendorName(name: string): string {
        return this.normalizeVendorName(name).replace(/\s+/g, "");
    }

    private computeSimilarity(a: string, b: string): number {
        if (!a || !b) return 0;
        if (a === b) return 1;

        const longer = a.length >= b.length ? a : b;
        const shorter = a.length >= b.length ? b : a;

        if (longer.includes(shorter) && shorter.length >= 4) {
            return shorter.length / longer.length;
        }

        const bigrams = (value: string): Set<string> => {
            if (value.length < 2) return new Set([value]);
            const set = new Set<string>();
            for (let i = 0; i < value.length - 1; i++) {
                set.add(value.slice(i, i + 2));
            }
            return set;
        };

        const aBigrams = bigrams(a);
        const bBigrams = bigrams(b);
        let overlap = 0;
        for (const gram of aBigrams) {
            if (bBigrams.has(gram)) {
                overlap += 1;
            }
        }

        return (2 * overlap) / (aBigrams.size + bBigrams.size);
    }

    private findVendorEntry(chatId: string | number, name: string): [string, VendorData] | null {
        const id = chatId.toString();
        const vendors = this.store[id]?.vendors || {};
        const requested = this.normalizeVendorName(name);
        const requestedCollapsed = this.collapseVendorName(name);

        for (const [storedName, data] of Object.entries(vendors)) {
            if (storedName === name.toLowerCase()) {
                return [storedName, data];
            }
            if (this.normalizeVendorName(storedName) === requested) {
                return [storedName, data];
            }
            if (this.collapseVendorName(storedName) === requestedCollapsed) {
                return [storedName, data];
            }
        }

        let bestMatch: [string, VendorData] | null = null;
        let bestScore = 0;
        let secondBestScore = 0;

        for (const [storedName, data] of Object.entries(vendors)) {
            const storedCollapsed = this.collapseVendorName(storedName);
            const score = this.computeSimilarity(storedCollapsed, requestedCollapsed);

            if (score > bestScore) {
                secondBestScore = bestScore;
                bestScore = score;
                bestMatch = [storedName, data];
            } else if (score > secondBestScore) {
                secondBestScore = score;
            }
        }

        if (bestMatch && bestScore >= 0.86 && bestScore - secondBestScore >= 0.08) {
            return bestMatch;
        }

        return null;
    }

    saveVendor(chatId: string | number, name: string, address: string): void {
        const id = chatId.toString();
        const vendorName = this.normalizeVendorName(name);

        if (!this.store[id]) {
            this.store[id] = { vendors: {} };
        }

        // Preserve existing stats if vendor already exists
        const existing = this.store[id].vendors[vendorName];
        this.store[id].vendors[vendorName] = {
            address,
            displayName: name.trim(),
            totalPaid: existing?.totalPaid || 0,
            invoiceCount: existing?.invoiceCount || 0,
            lastPayment: existing?.lastPayment || null,
            lastInvoice: existing?.lastInvoice || null
        };
        this.persist();
    }

    getVendor(chatId: string | number, name: string): string | null {
        const entry = this.resolveVendor(chatId, name);
        return entry ? entry.data.address : null;
    }

    getVendorNameByAddress(chatId: string | number, address: string): string | null {
        const id = chatId.toString();
        const normalizedAddress = address.toLowerCase();
        const vendors = this.store[id]?.vendors || {};

        for (const [name, data] of Object.entries(vendors)) {
            if (data.address.toLowerCase() === normalizedAddress) {
                return name;
            }
        }

        return null;
    }

    getVendorDisplayName(chatId: string | number, name: string): string | null {
        const entry = this.resolveVendor(chatId, name);
        return entry ? (entry.data.displayName || entry.name) : null;
    }

    getVendorDisplayNameByAddress(chatId: string | number, address: string): string | null {
        const id = chatId.toString();
        const normalizedAddress = address.toLowerCase();
        const vendors = this.store[id]?.vendors || {};

        for (const [name, data] of Object.entries(vendors)) {
            if (data.address.toLowerCase() === normalizedAddress) {
                return data.displayName || name;
            }
        }

        return null;
    }

    getVendorData(chatId: string | number, name: string): VendorData | null {
        const entry = this.resolveVendor(chatId, name);
        return entry ? entry.data : null;
    }

    resolveVendor(chatId: string | number, name: string): VendorMatch | null {
        const entry = this.findVendorEntry(chatId, name);
        return entry ? { name: entry[0], data: entry[1] } : null;
    }

    getVendors(chatId: string | number): Record<string, string> | null {
        const id = chatId.toString();
        if (!this.store[id]) return null;
        // Return simplified name → address map for backward compatibility
        const result: Record<string, string> = {};
        for (const [name, data] of Object.entries(this.store[id].vendors)) {
            result[name] = data.address;
        }
        return Object.keys(result).length > 0 ? result : null;
    }

    getVendorsWithStats(chatId: string | number): Record<string, VendorData> | null {
        const id = chatId.toString();
        if (!this.store[id]) return null;
        const vendors = this.store[id].vendors;
        return Object.keys(vendors).length > 0 ? vendors : null;
    }

    /**
     * Get top vendors sorted by totalPaid (descending)
     */
    getTopVendors(chatId: string | number, limit: number = 10): { name: string; data: VendorData }[] {
        const id = chatId.toString();
        if (!this.store[id]) return [];

        return Object.entries(this.store[id].vendors)
            .map(([name, data]) => ({ name, data }))
            .filter(v => v.data.totalPaid > 0)
            .sort((a, b) => b.data.totalPaid - a.data.totalPaid)
            .slice(0, limit);
    }

    /**
     * Record a payment to a vendor — updates statistics
     */
    recordPayment(chatId: string | number, vendorName: string, amount: number): void {
        const id = chatId.toString();
        const entry = this.findVendorEntry(chatId, vendorName);
        if (!entry || !this.store[id]?.vendors?.[entry[0]]) return;

        this.store[id].vendors[entry[0]].totalPaid += amount;
        this.store[id].vendors[entry[0]].invoiceCount += 1;
        this.store[id].vendors[entry[0]].lastPayment = Date.now();
        this.persist();
    }

    /**
     * Record an invoice for a vendor
     */
    recordInvoice(chatId: string | number, vendorName: string): void {
        const id = chatId.toString();
        const entry = this.findVendorEntry(chatId, vendorName);
        if (!entry || !this.store[id]?.vendors?.[entry[0]]) return;

        this.store[id].vendors[entry[0]].lastInvoice = Date.now();
        this.persist();
    }

    removeVendor(chatId: string | number, name: string): boolean {
        const id = chatId.toString();
        const entry = this.findVendorEntry(chatId, name);

        if (!this.store[id] || !entry) {
            return false;
        }

        delete this.store[id].vendors[entry[0]];
        this.persist();
        return true;
    }

    removeAllVendors(chatId: string | number): number {
        const id = chatId.toString();
        if (!this.store[id] || !this.store[id].vendors) return 0;

        const count = Object.keys(this.store[id].vendors).length;
        this.store[id].vendors = {};
        this.persist();
        return count;
    }
}
