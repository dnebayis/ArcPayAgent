import { describe, it, expect } from "vitest";
import { VendorStore } from "../../src/storage/vendorStore";

describe("VendorStore", () => {
    it("should save and retrieve vendors correctly", () => {
        const store = new VendorStore();

        store.saveVendor("1234", "jack", "0xabc123");
        expect(store.getVendor("1234", "jack")).toBe("0xabc123");
    });

    it("should resolve vendor names case-insensitively", () => {
        const store = new VendorStore();

        store.saveVendor(1, "Jack", "0xabc123");
        expect(store.getVendor(1, "jack")).toBe("0xabc123");
        expect(store.getVendor(1, "JACK")).toBe("0xabc123");
        expect(store.getVendor(1, "Jack")).toBe("0xabc123");
    });

    it("should resolve vendor names across punctuation differences", () => {
        const store = new VendorStore();

        store.saveVendor(1, "Anthropic, PBC", "0xabc123");
        expect(store.getVendor(1, "Anthropic PBC")).toBe("0xabc123");
    });

    it("should resolve vendor names across spacing differences", () => {
        const store = new VendorStore();

        store.saveVendor(1, "Office Rent", "0xabc123");
        expect(store.getVendor(1, "OfficeRent")).toBe("0xabc123");
    });

    it("should return canonical vendor match details", () => {
        const store = new VendorStore();

        store.saveVendor(1, "Anthropic, PBC", "0xabc123");
        const match = store.resolveVendor(1, "Anthropic PBC");

        expect(match).not.toBeNull();
        expect(match!.name).toBe("anthropic pbc");
        expect(match!.data.address).toBe("0xabc123");
    });

    it("should preserve display casing for vendor names", () => {
        const store = new VendorStore();

        store.saveVendor(1, "Anthropic, PBC", "0xabc123");

        expect(store.getVendorDisplayName(1, "anthropic pbc")).toBe("Anthropic, PBC");
        expect(store.getVendorDisplayNameByAddress(1, "0xabc123")).toBe("Anthropic, PBC");
    });

    it("should return null for non-existent vendors", () => {
        const store = new VendorStore();
        expect(store.getVendor("1234", "nobody")).toBeNull();
    });

    it("should isolate vendors per user", () => {
        const store = new VendorStore();

        store.saveVendor(1, "bob", "0x00001");
        store.saveVendor(2, "bob", "0x00002");

        expect(store.getVendor(1, "bob")).toBe("0x00001");
        expect(store.getVendor(2, "bob")).toBe("0x00002");
    });

    it("should overwrite existing vendor address but preserve stats", () => {
        const store = new VendorStore();

        store.saveVendor(1, "aws", "0xOldAddress");
        store.recordPayment(1, "aws", 50);
        store.saveVendor(1, "aws", "0xNewAddress");

        expect(store.getVendor(1, "aws")).toBe("0xNewAddress");
        // Stats should be preserved
        const data = store.getVendorData(1, "aws");
        expect(data!.totalPaid).toBe(50);
    });

    it("should list all vendors for a user", () => {
        const store = new VendorStore();

        store.saveVendor(1, "aws", "0x001");
        store.saveVendor(1, "gcp", "0x002");

        const vendors = store.getVendors(1);
        expect(vendors).not.toBeNull();
        expect(Object.keys(vendors!).length).toBe(2);
        expect(vendors!["aws"]).toBe("0x001");
        expect(vendors!["gcp"]).toBe("0x002");
    });

    it("should return null for getVendors when user has no vendors", () => {
        const store = new VendorStore();
        expect(store.getVendors(999)).toBeNull();
    });
});

describe("VendorStore — Statistics", () => {
    it("should record payment and update totalPaid", () => {
        const store = new VendorStore();
        store.saveVendor(1, "aws", "0x001");

        store.recordPayment(1, "aws", 25);
        store.recordPayment(1, "aws", 75);

        const data = store.getVendorData(1, "aws");
        expect(data).not.toBeNull();
        expect(data!.totalPaid).toBe(100);
        expect(data!.invoiceCount).toBe(2);
        expect(data!.lastPayment).toBeGreaterThan(0);
    });

    it("should record invoice timestamp", () => {
        const store = new VendorStore();
        store.saveVendor(1, "vercel", "0x002");

        store.recordInvoice(1, "vercel");

        const data = store.getVendorData(1, "vercel");
        expect(data!.lastInvoice).toBeGreaterThan(0);
    });

    it("should return top vendors sorted by totalPaid", () => {
        const store = new VendorStore();
        store.saveVendor(1, "aws", "0x001");
        store.saveVendor(1, "openai", "0x002");
        store.saveVendor(1, "vercel", "0x003");

        store.recordPayment(1, "aws", 120);
        store.recordPayment(1, "openai", 35);
        store.recordPayment(1, "vercel", 18);

        const top = store.getTopVendors(1);
        expect(top.length).toBe(3);
        expect(top[0].name).toBe("aws");
        expect(top[0].data.totalPaid).toBe(120);
        expect(top[1].name).toBe("openai");
        expect(top[2].name).toBe("vercel");
    });

    it("should exclude vendors with zero totalPaid from top vendors", () => {
        const store = new VendorStore();
        store.saveVendor(1, "aws", "0x001");
        store.saveVendor(1, "unused", "0x002");

        store.recordPayment(1, "aws", 50);

        const top = store.getTopVendors(1);
        expect(top.length).toBe(1);
        expect(top[0].name).toBe("aws");
    });

    it("should return full vendor data with getVendorData", () => {
        const store = new VendorStore();
        store.saveVendor(1, "aws", "0x001");

        const data = store.getVendorData(1, "aws");
        expect(data).not.toBeNull();
        expect(data!.address).toBe("0x001");
        expect(data!.totalPaid).toBe(0);
        expect(data!.invoiceCount).toBe(0);
        expect(data!.lastPayment).toBeNull();
        expect(data!.lastInvoice).toBeNull();
    });

    it("should remove a vendor", () => {
        const store = new VendorStore();
        store.saveVendor(1, "aws", "0x001");

        expect(store.removeVendor(1, "aws")).toBe(true);
        expect(store.getVendor(1, "aws")).toBeNull();
        expect(store.removeVendor(1, "aws")).toBe(false);
    });

    it("should remove all vendors", () => {
        const store = new VendorStore();
        store.saveVendor(1, "aws", "0x001");
        store.saveVendor(1, "gcp", "0x002");

        const count = store.removeAllVendors(1);
        expect(count).toBe(2);
        expect(store.getVendors(1)).toBeNull();
    });
});
