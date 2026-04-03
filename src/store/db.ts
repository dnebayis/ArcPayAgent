import * as fs from "fs";
import * as path from "path";
import { logger } from "../utils/logger";

/**
 * Database connection wrapper.
 *
 * Priority:
 *   1. PostgreSQL — when DATABASE_URL is set
 *   2. SQLite     — default (data/arcpay.sqlite), WAL mode
 *
 * All store files use this class directly via typed SQL queries.
 * Placeholder style: $1, $2, ... (auto-converted to ? for SQLite)
 *
 * Tables:
 *   wallets, vendors, payments, schedules, price_alerts,
 *   watch_config, pending_payments, submitted_txs, invoice_sessions,
 *   payment_requests, llm_keys, agent_identity, conversations
 */
export class DB {
    private pgPool: any = null;
    private sqlite: any = null;

    constructor(private dataDir: string = "data") {
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    }

    async init(): Promise<void> {
        const dbUrl = process.env.DATABASE_URL;
        if (dbUrl) {
            await this.initPostgres(dbUrl);
        } else {
            await this.initSQLite();
        }
        await this.createTables();
        await this.migrateFromKV();
    }

    private async initPostgres(dbUrl: string): Promise<void> {
        const { Pool } = await import("pg");
        const isLocal = dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1");
        const ssl = isLocal ? undefined : { rejectUnauthorized: false };
        this.pgPool = new Pool({ connectionString: dbUrl, ssl });
        logger.info(null, "[DB] PostgreSQL connected");
    }

    private async initSQLite(): Promise<void> {
        const Database = (await import("better-sqlite3")).default;
        const dbPath = path.join(this.dataDir, "arcpay.sqlite");
        this.sqlite = new Database(dbPath);
        this.sqlite.pragma("journal_mode = WAL");
        this.sqlite.pragma("foreign_keys = ON");
        logger.info(null, "[DB] SQLite initialized", { path: dbPath });
    }

    /** Execute a SELECT — returns all matching rows. */
    async query<T = Record<string, any>>(sql: string, params: any[] = []): Promise<T[]> {
        if (this.pgPool) {
            const res = await this.pgPool.query(sql, params);
            return res.rows as T[];
        }
        return this.sqlite.prepare(toSQLite(sql)).all(...params) as T[];
    }

    /** Execute INSERT / UPDATE / DELETE — returns nothing. */
    async run(sql: string, params: any[] = []): Promise<void> {
        if (this.pgPool) {
            await this.pgPool.query(sql, params);
        } else {
            this.sqlite.prepare(toSQLite(sql)).run(...params);
        }
    }

    /** Returns first row or null. */
    async queryOne<T = Record<string, any>>(sql: string, params: any[] = []): Promise<T | null> {
        const rows = await this.query<T>(sql, params);
        return rows[0] ?? null;
    }

    private async createTables(): Promise<void> {
        const tables = [
            `CREATE TABLE IF NOT EXISTS wallets (
                chat_id    BIGINT PRIMARY KEY,
                wallet_id  TEXT NOT NULL,
                address    TEXT NOT NULL,
                created_at BIGINT NOT NULL
            )`,
            `CREATE TABLE IF NOT EXISTS vendors (
                chat_id       BIGINT NOT NULL,
                name          TEXT NOT NULL,
                display_name  TEXT NOT NULL,
                address       TEXT NOT NULL,
                total_paid    REAL NOT NULL DEFAULT 0,
                payment_count INTEGER NOT NULL DEFAULT 0,
                last_payment  BIGINT,
                PRIMARY KEY (chat_id, name)
            )`,
            `CREATE TABLE IF NOT EXISTS payments (
                id        TEXT PRIMARY KEY,
                chat_id   BIGINT NOT NULL,
                vendor    TEXT NOT NULL,
                address   TEXT NOT NULL,
                amount    REAL NOT NULL,
                token     TEXT NOT NULL,
                timestamp BIGINT NOT NULL,
                memo      TEXT,
                tx_hash   TEXT
            )`,
            `CREATE TABLE IF NOT EXISTS schedules (
                id              TEXT PRIMARY KEY,
                chat_id         BIGINT NOT NULL,
                vendor          TEXT NOT NULL,
                address         TEXT NOT NULL,
                amount          REAL NOT NULL,
                token           TEXT NOT NULL,
                frequency       TEXT NOT NULL,
                next_execution  BIGINT NOT NULL,
                active          INTEGER NOT NULL DEFAULT 1,
                created_at      BIGINT NOT NULL,
                awaiting_action INTEGER NOT NULL DEFAULT 0
            )`,
            `CREATE TABLE IF NOT EXISTS price_alerts (
                id           TEXT PRIMARY KEY,
                chat_id      BIGINT NOT NULL,
                symbol       TEXT NOT NULL,
                target_price REAL NOT NULL,
                direction    TEXT NOT NULL,
                active       INTEGER NOT NULL DEFAULT 1,
                triggered    INTEGER NOT NULL DEFAULT 0,
                created_at   BIGINT NOT NULL,
                triggered_at BIGINT
            )`,
            `CREATE TABLE IF NOT EXISTS watch_config (
                chat_id           BIGINT PRIMARY KEY,
                enabled           INTEGER NOT NULL DEFAULT 0,
                wallet_address    TEXT NOT NULL,
                last_usdc_balance TEXT NOT NULL DEFAULT '0',
                last_eurc_balance TEXT NOT NULL DEFAULT '0',
                enabled_at        BIGINT NOT NULL
            )`,
            `CREATE TABLE IF NOT EXISTS pending_payments (
                chat_id     BIGINT PRIMARY KEY,
                beneficiary TEXT NOT NULL,
                vendor_name TEXT,
                amount_str  TEXT NOT NULL,
                amount      TEXT NOT NULL,
                memo        TEXT,
                token       TEXT NOT NULL,
                created_at  BIGINT NOT NULL,
                source      TEXT
            )`,
            `CREATE TABLE IF NOT EXISTS submitted_txs (
                chat_id         BIGINT PRIMARY KEY,
                tx_id           TEXT NOT NULL,
                idempotency_key TEXT NOT NULL,
                status          TEXT NOT NULL,
                context         TEXT NOT NULL,
                wallet_id       TEXT NOT NULL,
                beneficiary     TEXT NOT NULL,
                vendor_name     TEXT,
                amount_str      TEXT NOT NULL,
                amount          TEXT NOT NULL,
                memo            TEXT,
                token           TEXT NOT NULL,
                source          TEXT,
                submitted_at    BIGINT NOT NULL
            )`,
            `CREATE TABLE IF NOT EXISTS invoice_sessions (
                chat_id           BIGINT PRIMARY KEY,
                session_id        TEXT NOT NULL,
                status            TEXT NOT NULL,
                invoice_data      TEXT NOT NULL,
                risk              TEXT,
                resolution        TEXT,
                source_message_id BIGINT,
                opened_at         BIGINT NOT NULL,
                expires_at        BIGINT NOT NULL
            )`,
            `CREATE TABLE IF NOT EXISTS payment_requests (
                id                TEXT PRIMARY KEY,
                chat_id           BIGINT NOT NULL,
                recipient_address TEXT NOT NULL,
                amount            REAL NOT NULL,
                token             TEXT NOT NULL,
                paid              INTEGER NOT NULL DEFAULT 0,
                created_at        BIGINT NOT NULL
            )`,
            `CREATE TABLE IF NOT EXISTS llm_keys (
                chat_id       BIGINT PRIMARY KEY,
                provider      TEXT NOT NULL,
                encrypted_key TEXT NOT NULL,
                model         TEXT
            )`,
            `CREATE TABLE IF NOT EXISTS agent_identity (
                id                       TEXT PRIMARY KEY DEFAULT 'global',
                wallet_set_id            TEXT,
                owner_wallet_id          TEXT,
                owner_wallet_address     TEXT,
                validator_wallet_id      TEXT,
                validator_wallet_address TEXT,
                metadata_uri             TEXT,
                agent_id                 TEXT,
                status                   TEXT NOT NULL DEFAULT 'not_configured',
                registration_tx_id       TEXT,
                registration_tx_hash     TEXT,
                validation_request_hash  TEXT,
                validation_status        TEXT,
                last_synced_at           BIGINT
            )`,
            `CREATE TABLE IF NOT EXISTS conversations (
                chat_id    BIGINT PRIMARY KEY,
                messages   TEXT NOT NULL DEFAULT '[]',
                context    TEXT NOT NULL DEFAULT '{}',
                updated_at BIGINT NOT NULL
            )`,
        ];

        const indexes = [
            `CREATE INDEX IF NOT EXISTS idx_payments_chat_time  ON payments     (chat_id, timestamp DESC)`,
            `CREATE INDEX IF NOT EXISTS idx_schedules_chat       ON schedules    (chat_id)`,
            `CREATE INDEX IF NOT EXISTS idx_schedules_due        ON schedules    (active, next_execution)`,
            `CREATE INDEX IF NOT EXISTS idx_alerts_chat          ON price_alerts (chat_id)`,
            `CREATE INDEX IF NOT EXISTS idx_alerts_active        ON price_alerts (active, triggered)`,
            `CREATE INDEX IF NOT EXISTS idx_requests_chat        ON payment_requests (chat_id)`,
        ];

        for (const sql of [...tables, ...indexes]) {
            await this.run(sql);
        }
        logger.info(null, "[DB] Schema ready");
    }

    /** One-time migration: copies rows from legacy kv table into typed tables. */
    private async migrateFromKV(): Promise<void> {
        try {
            const kvExists = await this.tableExists("kv");
            if (!kvExists) return;

            logger.info(null, "[DB] Migrating legacy KV data...");
            const rows = await this.query<{ namespace: string; key: string; value: any }>(
                "SELECT namespace, key, value FROM kv"
            );

            let ok = 0;
            for (const row of rows) {
                try {
                    const value = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
                    await this.migrateRow(row.namespace, row.key, value);
                    ok++;
                } catch (e: any) {
                    logger.warn(null, "[DB] Migration skip", { ns: row.namespace, key: row.key, err: e?.message });
                }
            }

            // Rename so migration never runs again
            await this.run("ALTER TABLE kv RENAME TO kv_migrated");
            logger.info(null, `[DB] Migration done — ${ok}/${rows.length} records`);
        } catch (err: any) {
            logger.warn(null, "[DB] Migration skipped (non-fatal)", { error: err?.message });
        }
    }

    private async tableExists(name: string): Promise<boolean> {
        if (this.pgPool) {
            const res = await this.pgPool.query(
                "SELECT 1 FROM information_schema.tables WHERE table_name=$1 LIMIT 1",
                [name]
            );
            return res.rows.length > 0;
        }
        const row = this.sqlite
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
            .get(name);
        return !!row;
    }

    private async migrateRow(namespace: string, key: string, v: any): Promise<void> {
        switch (namespace) {
            case "wallets": {
                await this.run(
                    `INSERT INTO wallets (chat_id,wallet_id,address,created_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
                    [+key, v.walletId, v.address, v.createdAt ?? Date.now()]
                );
                break;
            }
            case "vendors": {
                const [cid, name] = key.split(":");
                await this.run(
                    `INSERT INTO vendors (chat_id,name,display_name,address,total_paid,payment_count,last_payment) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
                    [+cid, name, v.displayName ?? name, v.address, v.totalPaid ?? 0, v.paymentCount ?? 0, v.lastPayment ?? null]
                );
                break;
            }
            case "payments": {
                const [cid, id] = key.split(":");
                await this.run(
                    `INSERT INTO payments (id,chat_id,vendor,address,amount,token,timestamp,memo,tx_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
                    [v.id ?? id, +cid, v.vendor, v.address, v.amount, v.token, v.timestamp, v.memo ?? null, v.txHash ?? null]
                );
                break;
            }
            case "schedules": {
                const [cid, id] = key.split(":");
                await this.run(
                    `INSERT INTO schedules (id,chat_id,vendor,address,amount,token,frequency,next_execution,active,created_at,awaiting_action) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
                    [v.id ?? id, +cid, v.vendor, v.address, v.amount, v.token, v.frequency, v.nextExecution, v.active ? 1 : 0, v.createdAt, v.awaitingAction ? 1 : 0]
                );
                break;
            }
            case "alerts": {
                const [cid, id] = key.split(":");
                await this.run(
                    `INSERT INTO price_alerts (id,chat_id,symbol,target_price,direction,active,triggered,created_at,triggered_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
                    [v.id ?? id, +cid, v.symbol, v.targetPrice, v.direction, v.active ? 1 : 0, v.triggered ? 1 : 0, v.createdAt, v.triggeredAt ?? null]
                );
                break;
            }
            case "watch": {
                await this.run(
                    `INSERT INTO watch_config (chat_id,enabled,wallet_address,last_usdc_balance,last_eurc_balance,enabled_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
                    [+key, v.enabled ? 1 : 0, v.walletAddress, v.lastUsdcBalance ?? "0", v.lastEurcBalance ?? "0", v.enabledAt ?? Date.now()]
                );
                break;
            }
            case "pending": {
                await this.run(
                    `INSERT INTO pending_payments (chat_id,beneficiary,vendor_name,amount_str,amount,memo,token,created_at,source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
                    [+key, v.beneficiary, v.vendorName ?? null, v.amountStr, v.amount, v.memo ?? null, v.token, v.createdAt, v.source ? JSON.stringify(v.source) : null]
                );
                break;
            }
            case "submitted": {
                await this.run(
                    `INSERT INTO submitted_txs (chat_id,tx_id,idempotency_key,status,context,wallet_id,beneficiary,vendor_name,amount_str,amount,memo,token,source,submitted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING`,
                    [+key, v.txId, v.idempotencyKey, v.status, v.context, v.walletId, v.beneficiary, v.vendorName ?? null, v.amountStr, v.amount, v.memo ?? null, v.token, v.source ? JSON.stringify(v.source) : null, v.submittedAt]
                );
                break;
            }
            case "invoices": {
                await this.run(
                    `INSERT INTO invoice_sessions (chat_id,session_id,status,invoice_data,risk,resolution,source_message_id,opened_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
                    [+key, v.id, v.status, JSON.stringify(v.invoice), v.risk ? JSON.stringify(v.risk) : null, v.resolution ? JSON.stringify(v.resolution) : null, v.sourceMessageId ?? null, v.openedAt, v.expiresAt]
                );
                break;
            }
            case "requests": {
                await this.run(
                    `INSERT INTO payment_requests (id,chat_id,recipient_address,amount,token,paid,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
                    [v.id ?? key, v.chatId, v.recipientAddress, v.amount, v.token, v.paid ? 1 : 0, v.createdAt]
                );
                break;
            }
            case "keys": {
                await this.run(
                    `INSERT INTO llm_keys (chat_id,provider,encrypted_key,model) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
                    [+key, v.provider, v.encryptedKey, v.model ?? null]
                );
                break;
            }
            case "identity": {
                await this.run(
                    `INSERT INTO agent_identity (id,wallet_set_id,owner_wallet_id,owner_wallet_address,validator_wallet_id,validator_wallet_address,metadata_uri,agent_id,status,registration_tx_id,registration_tx_hash,validation_request_hash,validation_status,last_synced_at)
                     VALUES ('global',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,
                    [v.walletSetId ?? null, v.ownerWalletId ?? null, v.ownerWalletAddress ?? null, v.validatorWalletId ?? null, v.validatorWalletAddress ?? null, v.metadataUri ?? null, v.agentId ?? null, v.status ?? "not_configured", v.registrationTxId ?? null, v.registrationTxHash ?? null, v.validationRequestHash ?? null, v.validationStatus ?? null, v.lastSyncedAt ?? null]
                );
                break;
            }
        }
    }

    async close(): Promise<void> {
        if (this.pgPool) await this.pgPool.end();
        if (this.sqlite) this.sqlite.close();
    }
}

/** Convert $1, $2, ... placeholders to ? for SQLite. */
function toSQLite(sql: string): string {
    return sql.replace(/\$\d+/g, "?");
}
