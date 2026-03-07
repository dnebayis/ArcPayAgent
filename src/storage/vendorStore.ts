import { loadStore, saveStore } from "./persistence";

const VENDOR_FILE = "vendors.json";

export interface VendorData {
    address: string;
    totalPaid: number;
    invoiceCount: number;
    lastPayment: number | null;
    lastInvoice: number | null;
}

export interface UserVendors {
    vendors: Record<string, VendorData>;
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
                        totalPaid: 0,
                        invoiceCount: 0,
                        lastPayment: null,
                        lastInvoice: null
                    };
                } else if (typeof value === "object" && value !== null && (value as any).address) {
                    // New format — keep as is
                    vendors[name] = value as VendorData;
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

    private findVendorEntry(chatId: string | number, name: string): [string, VendorData] | null {
        const id = chatId.toString();
        const vendors = this.store[id]?.vendors || {};
        const requested = this.normalizeVendorName(name);

        for (const [storedName, data] of Object.entries(vendors)) {
            if (storedName === name.toLowerCase()) {
                return [storedName, data];
            }
            if (this.normalizeVendorName(storedName) === requested) {
                return [storedName, data];
            }
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
            totalPaid: existing?.totalPaid || 0,
            invoiceCount: existing?.invoiceCount || 0,
            lastPayment: existing?.lastPayment || null,
            lastInvoice: existing?.lastInvoice || null
        };
        this.persist();
    }

    getVendor(chatId: string | number, name: string): string | null {
        const entry = this.findVendorEntry(chatId, name);
        return entry ? entry[1].address : null;
    }

    getVendorData(chatId: string | number, name: string): VendorData | null {
        const entry = this.findVendorEntry(chatId, name);
        return entry ? entry[1] : null;
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
