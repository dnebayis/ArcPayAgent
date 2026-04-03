import * as fs from "fs";
import * as path from "path";
import { logger } from "../utils/logger";

/**
 * Persistent key-value store.
 *
 * Priority:
 *   1. PostgreSQL  — when DATABASE_URL is set
 *   2. SQLite      — default (data/arcpay.sqlite), single file, atomic writes
 *
 * The in-memory cache prevents redundant reads within the same process lifetime.
 * On restart the cache is rebuilt from the persistent backend.
 */
export class Store {
    private cache = new Map<string, Record<string, any>>();
    private pgPool: any = null;
    private sqlite: any = null;

    constructor(private dataDir: string = "data") {
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    }

    async init(): Promise<void> {
        const dbUrl = process.env.DATABASE_URL;

        if (dbUrl) {
            const { Pool } = await import("pg");
            this.pgPool = new Pool({ connectionString: dbUrl });
            await this.pgPool.query(`
                CREATE TABLE IF NOT EXISTS kv (
                    namespace TEXT NOT NULL,
                    key       TEXT NOT NULL,
                    value     JSONB NOT NULL,
                    PRIMARY KEY (namespace, key)
                )
            `);
            logger.info(null, "[Store] PostgreSQL initialized");
        } else {
            const Database = (await import("better-sqlite3")).default;
            const dbPath = path.join(this.dataDir, "arcpay.sqlite");
            this.sqlite = new Database(dbPath);
            this.sqlite.exec(`
                CREATE TABLE IF NOT EXISTS kv (
                    namespace TEXT NOT NULL,
                    key       TEXT NOT NULL,
                    value     TEXT NOT NULL,
                    PRIMARY KEY (namespace, key)
                )
            `);
            // WAL mode: faster writes, safe on crash
            this.sqlite.pragma("journal_mode = WAL");
            logger.info(null, "[Store] SQLite initialized", { path: dbPath });
        }
    }

    async get<T>(namespace: string, key: string): Promise<T | null> {
        const ns = await this.loadNamespace(namespace);
        return (ns[key] as T) ?? null;
    }

    async set(namespace: string, key: string, value: any): Promise<void> {
        const ns = await this.loadNamespace(namespace);
        ns[key] = value;
        this.persist(namespace, key, value);
    }

    async delete(namespace: string, key: string): Promise<void> {
        const ns = await this.loadNamespace(namespace);
        delete ns[key];
        this.persistDelete(namespace, key);
    }

    async getAll<T>(namespace: string): Promise<Record<string, T>> {
        return (await this.loadNamespace(namespace)) as Record<string, T>;
    }

    private async loadNamespace(namespace: string): Promise<Record<string, any>> {
        if (this.cache.has(namespace)) return this.cache.get(namespace)!;

        const data: Record<string, any> = {};

        if (this.pgPool) {
            const res = await this.pgPool.query(
                "SELECT key, value FROM kv WHERE namespace = $1",
                [namespace]
            );
            for (const row of res.rows) data[row.key] = row.value;
        } else if (this.sqlite) {
            const rows = this.sqlite
                .prepare("SELECT key, value FROM kv WHERE namespace = ?")
                .all(namespace) as { key: string; value: string }[];
            for (const row of rows) {
                try { data[row.key] = JSON.parse(row.value); } catch { data[row.key] = row.value; }
            }
        }

        this.cache.set(namespace, data);
        return data;
    }

    /** Upsert a single row — synchronous for SQLite, async for PostgreSQL. */
    private persist(namespace: string, key: string, value: any): void {
        const json = JSON.stringify(value);

        if (this.pgPool) {
            this.pgPool.query(
                `INSERT INTO kv (namespace, key, value)
                 VALUES ($1, $2, $3::jsonb)
                 ON CONFLICT (namespace, key) DO UPDATE SET value = $3::jsonb`,
                [namespace, key, json]
            ).catch((err: any) => {
                logger.error(null, "[Store] PG write failed", { namespace, key, error: err?.message });
            });
        } else if (this.sqlite) {
            try {
                this.sqlite
                    .prepare(
                        `INSERT INTO kv (namespace, key, value)
                         VALUES (?, ?, ?)
                         ON CONFLICT (namespace, key) DO UPDATE SET value = excluded.value`
                    )
                    .run(namespace, key, json);
            } catch (err: any) {
                logger.error(null, "[Store] SQLite write failed", { namespace, key, error: err?.message });
            }
        }
    }

    private persistDelete(namespace: string, key: string): void {
        if (this.pgPool) {
            this.pgPool.query(
                "DELETE FROM kv WHERE namespace = $1 AND key = $2",
                [namespace, key]
            ).catch((err: any) => {
                logger.error(null, "[Store] PG delete failed", { namespace, key, error: err?.message });
            });
        } else if (this.sqlite) {
            try {
                this.sqlite
                    .prepare("DELETE FROM kv WHERE namespace = ? AND key = ?")
                    .run(namespace, key);
            } catch (err: any) {
                logger.error(null, "[Store] SQLite delete failed", { namespace, key, error: err?.message });
            }
        }
    }

    async close(): Promise<void> {
        if (this.pgPool) await this.pgPool.end();
        if (this.sqlite) this.sqlite.close();
    }
}
