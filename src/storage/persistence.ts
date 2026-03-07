import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { Pool } from "pg";

const DATA_DIR = path.join(process.cwd(), "data");
const SQLITE_FILE = path.join(DATA_DIR, "arcpay.sqlite");
const STORE_TABLE = "stores";

let database: DatabaseSync | null = null;
let postgresPool: Pool | null = null;
let initialized = false;
let cachedPayloads = new Map<string, string>();
let writeQueue: Promise<void> = Promise.resolve();

/**
 * Ensures the data directory exists
 */
function ensureDataDir(): void {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function usePostgres(): boolean {
    return !!process.env.DATABASE_URL;
}

function getDatabase(): DatabaseSync {
    ensureDataDir();

    if (!database) {
        database = new DatabaseSync(SQLITE_FILE);
        database.exec(`
            CREATE TABLE IF NOT EXISTS ${STORE_TABLE} (
                store_name TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            )
        `);
    }

    return database;
}

function getPostgresPool(): Pool {
    if (!postgresPool) {
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error("DATABASE_URL is not defined");
        }

        postgresPool = new Pool({ connectionString });
    }

    return postgresPool;
}

function loadLegacyJson<T extends Record<string, any>>(filename: string): { found: boolean; data: T } {
    ensureDataDir();
    const filePath = path.join(DATA_DIR, filename);

    if (!fs.existsSync(filePath)) {
        return { found: false, data: {} as T };
    }

    try {
        const raw = fs.readFileSync(filePath, "utf-8");
        return { found: true, data: JSON.parse(raw) as T };
    } catch {
        return { found: true, data: {} as T };
    }
}

function primeSqliteCache(): void {
    const db = getDatabase();
    const rows = db.prepare(`SELECT store_name, payload FROM ${STORE_TABLE}`).all() as Array<{ store_name: string; payload: string }>;
    cachedPayloads = new Map(rows.map((row) => [row.store_name, row.payload]));
    initialized = true;
}

function ensureInitialized(): void {
    if (initialized) {
        return;
    }

    if (usePostgres()) {
        throw new Error("Persistence not initialized. Call initializePersistence() before using stores when DATABASE_URL is set.");
    }

    primeSqliteCache();
}

function enqueueWrite(task: () => Promise<void>): void {
    writeQueue = writeQueue
        .then(task)
        .catch((error) => {
            console.error("[Persistence] Failed to write store:", error);
        });
}

export async function initializePersistence(): Promise<void> {
    if (initialized) {
        return;
    }

    ensureDataDir();

    if (usePostgres()) {
        const pool = getPostgresPool();
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ${STORE_TABLE} (
                store_name TEXT PRIMARY KEY,
                payload JSONB NOT NULL,
                updated_at BIGINT NOT NULL
            )
        `);

        const result = await pool.query<{ store_name: string; payload: unknown }>(
            `SELECT store_name, payload FROM ${STORE_TABLE}`
        );

        cachedPayloads = new Map(
            result.rows.map((row: { store_name: string; payload: unknown }) => [row.store_name, JSON.stringify(row.payload ?? {})])
        );
        initialized = true;
        return;
    }

    primeSqliteCache();
}

export async function flushPersistence(): Promise<void> {
    await writeQueue;
}

export function getPersistenceBackend(): "postgres" | "sqlite" {
    return usePostgres() ? "postgres" : "sqlite";
}

/**
 * Load store data from SQLite. If no SQLite record exists yet,
 * fall back to a legacy JSON file and migrate it automatically.
 */
export function loadStore<T extends Record<string, any>>(filename: string): T {
    ensureInitialized();

    const payload = cachedPayloads.get(filename);
    if (payload) {
        try {
            return JSON.parse(payload) as T;
        } catch {
            return {} as T;
        }
    }

    const legacy = loadLegacyJson<T>(filename);
    if (legacy.found) {
        saveStore(filename, legacy.data);
        return legacy.data;
    }

    return {} as T;
}

/**
 * Save store data into SQLite.
 */
export function saveStore<T extends Record<string, any>>(filename: string, data: T): void {
    const payload = JSON.stringify(data ?? {});
    cachedPayloads.set(filename, payload);

    if (usePostgres()) {
        const pool = getPostgresPool();
        enqueueWrite(async () => {
            await pool.query(
                `
                    INSERT INTO ${STORE_TABLE} (store_name, payload, updated_at)
                    VALUES ($1, $2::jsonb, $3)
                    ON CONFLICT(store_name) DO UPDATE SET
                        payload = excluded.payload,
                        updated_at = excluded.updated_at
                `,
                [filename, payload, Date.now()]
            );
        });
        return;
    }

    const db = getDatabase();
    db.prepare(`
        INSERT INTO ${STORE_TABLE} (store_name, payload, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(store_name) DO UPDATE SET
            payload = excluded.payload,
            updated_at = excluded.updated_at
    `).run(filename, payload, Date.now());
}
