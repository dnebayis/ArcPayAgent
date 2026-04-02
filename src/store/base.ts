import * as fs from "fs";
import * as path from "path";
import { logger } from "../utils/logger";

export class Store {
    private cache = new Map<string, Record<string, any>>();
    private writeQueue: Promise<void> = Promise.resolve();
    private pgPool: any = null;

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
                    key TEXT NOT NULL,
                    value JSONB NOT NULL,
                    PRIMARY KEY (namespace, key)
                )
            `);
            logger.info(null, "[Store] PostgreSQL initialized");
        } else {
            logger.info(null, "[Store] Using JSON file backend", { dataDir: this.dataDir });
        }
    }

    async get<T>(namespace: string, key: string): Promise<T | null> {
        const ns = await this.loadNamespace(namespace);
        return (ns[key] as T) ?? null;
    }

    async set(namespace: string, key: string, value: any): Promise<void> {
        const ns = await this.loadNamespace(namespace);
        ns[key] = value;
        await this.persist(namespace, ns);
    }

    async delete(namespace: string, key: string): Promise<void> {
        const ns = await this.loadNamespace(namespace);
        delete ns[key];
        await this.persist(namespace, ns);
    }

    async getAll<T>(namespace: string): Promise<Record<string, T>> {
        return (await this.loadNamespace(namespace)) as Record<string, T>;
    }

    private async loadNamespace(namespace: string): Promise<Record<string, any>> {
        if (this.cache.has(namespace)) return this.cache.get(namespace)!;

        let data: Record<string, any> = {};

        if (this.pgPool) {
            const res = await this.pgPool.query("SELECT key, value FROM kv WHERE namespace = $1", [namespace]);
            for (const row of res.rows) data[row.key] = row.value;
        } else {
            const filePath = path.join(this.dataDir, `${namespace}.json`);
            if (fs.existsSync(filePath)) {
                try {
                    data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
                } catch { data = {}; }
            }
        }

        this.cache.set(namespace, data);
        return data;
    }

    private async persist(namespace: string, data: Record<string, any>): Promise<void> {
        if (this.pgPool) {
            for (const [key, value] of Object.entries(data)) {
                await this.pgPool.query(
                    `INSERT INTO kv (namespace, key, value) VALUES ($1, $2, $3)
                     ON CONFLICT (namespace, key) DO UPDATE SET value = $3`,
                    [namespace, key, JSON.stringify(value)]
                );
            }
        } else {
            this.writeQueue = this.writeQueue.then(() => {
                const filePath = path.join(this.dataDir, `${namespace}.json`);
                fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            }).catch(err => {
                logger.error(null, "[Store] Write failed", { namespace, error: err?.message });
            });
            await this.writeQueue;
        }
    }

    async close(): Promise<void> {
        await this.writeQueue;
        if (this.pgPool) await this.pgPool.end();
    }
}
