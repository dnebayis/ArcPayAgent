import { DB } from "./db";

export interface AgentIdentity {
    walletSetId?: string;
    ownerWalletId?: string;
    ownerWalletAddress?: string;
    validatorWalletId?: string;
    validatorWalletAddress?: string;
    metadataUri?: string;
    agentId?: string;
    status: "not_configured" | "not_registered" | "registering" | "registered" | "needs_reconcile" | "failed";
    registrationTxId?: string;
    registrationTxHash?: string;
    validationRequestHash?: string;
    validationStatus?: string;
    lastSyncedAt?: number;
}

export class AgentIdentityStore {
    constructor(private db: DB) {}

    async get(): Promise<AgentIdentity | null> {
        const row = await this.db.queryOne<any>(
            "SELECT * FROM agent_identity WHERE id='global'"
        );
        return row ? rowToIdentity(row) : null;
    }

    async save(identity: AgentIdentity): Promise<void> {
        await this.db.run(
            `INSERT INTO agent_identity
               (id,wallet_set_id,owner_wallet_id,owner_wallet_address,validator_wallet_id,
                validator_wallet_address,metadata_uri,agent_id,status,registration_tx_id,
                registration_tx_hash,validation_request_hash,validation_status,last_synced_at)
             VALUES ('global',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             ON CONFLICT (id) DO UPDATE SET
               wallet_set_id=$1,owner_wallet_id=$2,owner_wallet_address=$3,
               validator_wallet_id=$4,validator_wallet_address=$5,metadata_uri=$6,
               agent_id=$7,status=$8,registration_tx_id=$9,registration_tx_hash=$10,
               validation_request_hash=$11,validation_status=$12,last_synced_at=$13`,
            [identity.walletSetId ?? null, identity.ownerWalletId ?? null,
             identity.ownerWalletAddress ?? null, identity.validatorWalletId ?? null,
             identity.validatorWalletAddress ?? null, identity.metadataUri ?? null,
             identity.agentId ?? null, identity.status,
             identity.registrationTxId ?? null, identity.registrationTxHash ?? null,
             identity.validationRequestHash ?? null, identity.validationStatus ?? null,
             identity.lastSyncedAt ?? null]
        );
    }

    async updateField<K extends keyof AgentIdentity>(field: K, value: AgentIdentity[K]): Promise<void> {
        const current = (await this.get()) ?? ({ status: "not_configured" } as AgentIdentity);
        await this.save({ ...current, [field]: value });
    }
}

function rowToIdentity(row: any): AgentIdentity {
    return {
        walletSetId: row.wallet_set_id ?? undefined,
        ownerWalletId: row.owner_wallet_id ?? undefined,
        ownerWalletAddress: row.owner_wallet_address ?? undefined,
        validatorWalletId: row.validator_wallet_id ?? undefined,
        validatorWalletAddress: row.validator_wallet_address ?? undefined,
        metadataUri: row.metadata_uri ?? undefined,
        agentId: row.agent_id ?? undefined,
        status: row.status,
        registrationTxId: row.registration_tx_id ?? undefined,
        registrationTxHash: row.registration_tx_hash ?? undefined,
        validationRequestHash: row.validation_request_hash ?? undefined,
        validationStatus: row.validation_status ?? undefined,
        lastSyncedAt: row.last_synced_at ? Number(row.last_synced_at) : undefined,
    };
}
