import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

const DATA_DIR = path.join(process.cwd(), "data");
const SQLITE_FILE = path.join(DATA_DIR, "arcpay.sqlite");
const TELEGRAM_LIVE_LOG_DIR = path.join(process.cwd(), ".telegram-live", "logs");
const TELEGRAM_AUDIT_FILE = path.join(process.cwd(), ".telegram-audit", "outbound.jsonl");

type JsonRecord = Record<string, any>;

const syntheticVendorPattern = /^(?:live(?:[\s_-](?:suite|probe|natural).*)?|short[\s_-]live)$/i;

function matchesSyntheticVendor(value: unknown): boolean {
    return typeof value === "string" && syntheticVendorPattern.test(value.trim());
}

function loadStorePayload(db: DatabaseSync, storeName: string): JsonRecord {
    const row = db.prepare("SELECT payload FROM stores WHERE store_name = ?").get(storeName) as { payload?: string } | undefined;
    if (!row?.payload) {
        return {};
    }

    try {
        return JSON.parse(row.payload) as JsonRecord;
    } catch {
        return {};
    }
}

function saveStorePayload(db: DatabaseSync, storeName: string, payload: JsonRecord): void {
    db.prepare(`
        INSERT INTO stores (store_name, payload, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(store_name) DO UPDATE SET
            payload = excluded.payload,
            updated_at = excluded.updated_at
    `).run(storeName, JSON.stringify(payload), Date.now());
}

function pruneMemoryStore(db: DatabaseSync): number {
    const payload = loadStorePayload(db, "memory.json");
    let removed = 0;

    for (const user of Object.values(payload) as Array<JsonRecord>) {
        if (!user || typeof user !== "object") {
            continue;
        }

        if (user.favoriteVendors && typeof user.favoriteVendors === "object") {
            for (const key of Object.keys(user.favoriteVendors)) {
                if (matchesSyntheticVendor(key)) {
                    delete user.favoriteVendors[key];
                    removed += 1;
                }
            }
        }

        if (Array.isArray(user.recentPayments)) {
            const before = user.recentPayments.length;
            user.recentPayments = user.recentPayments.filter((entry: JsonRecord) => !matchesSyntheticVendor(entry?.vendor));
            removed += before - user.recentPayments.length;
        }

        if (Array.isArray(user.recentInvoices)) {
            const before = user.recentInvoices.length;
            user.recentInvoices = user.recentInvoices.filter((entry: JsonRecord) => !matchesSyntheticVendor(entry?.vendor));
            removed += before - user.recentInvoices.length;
        }
    }

    saveStorePayload(db, "memory.json", payload);
    return removed;
}

function pruneVendorStore(db: DatabaseSync): number {
    const payload = loadStorePayload(db, "vendors.json");
    let removed = 0;

    for (const user of Object.values(payload) as Array<JsonRecord>) {
        const vendors = user?.vendors;
        if (!vendors || typeof vendors !== "object") {
            continue;
        }

        for (const [key, value] of Object.entries(vendors)) {
            const displayName = typeof value === "object" && value ? (value as JsonRecord).displayName : undefined;
            if (matchesSyntheticVendor(key) || matchesSyntheticVendor(displayName)) {
                delete vendors[key];
                removed += 1;
            }
        }
    }

    saveStorePayload(db, "vendors.json", payload);
    return removed;
}

function prunePaymentLogs(db: DatabaseSync): number {
    const payload = loadStorePayload(db, "payment_logs.json");
    let removed = 0;

    for (const user of Object.values(payload) as Array<JsonRecord>) {
        if (!Array.isArray(user?.payments)) {
            continue;
        }

        const before = user.payments.length;
        user.payments = user.payments.filter((entry: JsonRecord) => !matchesSyntheticVendor(entry?.vendor));
        removed += before - user.payments.length;
    }

    saveStorePayload(db, "payment_logs.json", payload);
    return removed;
}

function pruneSchedules(db: DatabaseSync): number {
    const payload = loadStorePayload(db, "schedules.json");
    let removed = 0;

    for (const user of Object.values(payload) as Array<JsonRecord>) {
        if (!Array.isArray(user?.schedules)) {
            continue;
        }

        const before = user.schedules.length;
        user.schedules = user.schedules.filter((entry: JsonRecord) => !matchesSyntheticVendor(entry?.vendor));
        removed += before - user.schedules.length;
    }

    saveStorePayload(db, "schedules.json", payload);
    return removed;
}

function deleteIfExists(targetPath: string): boolean {
    if (!fs.existsSync(targetPath)) {
        return false;
    }

    fs.rmSync(targetPath, { recursive: true, force: true });
    return true;
}

function main(): void {
    let removedLiveLogs = 0;
    let removedAuditLog = 0;
    let removedTaskStore = 0;
    let removedMemoryEntries = 0;
    let removedVendorEntries = 0;
    let removedPaymentEntries = 0;
    let removedScheduleEntries = 0;

    if (fs.existsSync(TELEGRAM_LIVE_LOG_DIR)) {
        const files = fs.readdirSync(TELEGRAM_LIVE_LOG_DIR);
        for (const file of files) {
            if (deleteIfExists(path.join(TELEGRAM_LIVE_LOG_DIR, file))) {
                removedLiveLogs += 1;
            }
        }
    }

    if (deleteIfExists(TELEGRAM_AUDIT_FILE)) {
        removedAuditLog = 1;
    }

    if (fs.existsSync(SQLITE_FILE)) {
        const db = new DatabaseSync(SQLITE_FILE);
        const result = db.prepare("DELETE FROM stores WHERE store_name = ?").run("agent_tasks.json");
        removedTaskStore = Number(result.changes || 0);
        removedMemoryEntries = pruneMemoryStore(db);
        removedVendorEntries = pruneVendorStore(db);
        removedPaymentEntries = prunePaymentLogs(db);
        removedScheduleEntries = pruneSchedules(db);
        db.close();
    }

    console.log(JSON.stringify({
        removedLiveLogs,
        removedAuditLog,
        removedTaskStore,
        removedMemoryEntries,
        removedVendorEntries,
        removedPaymentEntries,
        removedScheduleEntries
    }, null, 2));
}

main();
