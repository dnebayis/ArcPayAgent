import { registerAction } from "./registry";
import type { VendorStore } from "../store/vendors";
import type { ConversationMemory } from "../memory/conversation";

export interface VendorActionDeps {
    vendors: VendorStore;
    memory: ConversationMemory;
    send: (chatId: number, text: string) => Promise<void>;
}

export function registerVendorActions(deps: VendorActionDeps): void {
    registerAction("save_vendor", async (chatId, params) => {
        const { name, address } = params;
        if (!name || !address) {
            await deps.send(chatId, "Please provide both a vendor name and wallet address.");
            return;
        }
        if (!address.startsWith("0x") || address.length !== 42) {
            await deps.send(chatId, "Invalid wallet address. Please provide a valid 0x address.");
            return;
        }
        await deps.vendors.saveVendor(chatId, name, address);
        deps.memory.setLastVendor(chatId, name, address);
        await deps.send(chatId, `Vendor "${name}" saved with address ${address.slice(0, 6)}...${address.slice(-4)}.`);
    });

    registerAction("list_vendors", async (chatId) => {
        const vendors = await deps.vendors.listVendors(chatId);
        const entries = Object.entries(vendors);
        if (entries.length === 0) {
            await deps.send(chatId, "No saved vendors.");
            return;
        }

        let text = "Saved Vendors\n\n";
        for (const [, data] of entries) {
            text += `${data.displayName}: ${data.address.slice(0, 6)}...${data.address.slice(-4)}`;
            if (data.paymentCount > 0) {
                text += ` ($${data.totalPaid.toFixed(2)}, ${data.paymentCount} payments)`;
            }
            text += "\n";
        }
        await deps.send(chatId, text);
    });

    registerAction("remove_vendor", async (chatId, params) => {
        const { name } = params;
        if (!name) {
            await deps.send(chatId, "Please specify which vendor to remove.");
            return;
        }
        const removed = await deps.vendors.removeVendor(chatId, name);
        await deps.send(chatId, removed
            ? `Vendor "${name}" removed.`
            : `Vendor "${name}" not found.`);
    });

    registerAction("remove_all_vendors", async (chatId) => {
        const count = await deps.vendors.removeAll(chatId);
        await deps.send(chatId, count > 0
            ? `Removed ${count} vendor(s).`
            : "No vendors to remove.");
    });

    registerAction("vendor_detail", async (chatId, params) => {
        const { name } = params;
        if (!name) {
            await deps.send(chatId, "Please specify a vendor name.");
            return;
        }
        const found = await deps.vendors.findVendor(chatId, name);
        if (!found) {
            await deps.send(chatId, `Vendor "${name}" not found.`);
            return;
        }
        const d = found.data;
        let text = `Vendor: ${d.displayName}\nAddress: ${d.address}`;
        text += `\nTotal paid: $${d.totalPaid.toFixed(2)}`;
        text += `\nPayments: ${d.paymentCount}`;
        if (d.lastPayment) {
            text += `\nLast payment: ${new Date(d.lastPayment).toLocaleDateString("en-US")}`;
        }
        await deps.send(chatId, text);
    });

    registerAction("top_vendors", async (chatId) => {
        // Delegated to analytics engine — but we can handle here too
        const top = await deps.vendors.getTopVendors(chatId, 5);
        if (top.length === 0) {
            await deps.send(chatId, "No vendors found.");
            return;
        }
        let text = "Top Vendors\n\n";
        for (let i = 0; i < top.length; i++) {
            const v = top[i];
            text += `${i + 1}. ${v.data.displayName}: $${v.data.totalPaid.toFixed(2)} (${v.data.paymentCount} payments)\n`;
        }
        await deps.send(chatId, text);
    });
}
