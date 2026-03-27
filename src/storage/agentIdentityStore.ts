import { loadStore, saveStore } from "./persistence";

const AGENT_IDENTITY_FILE = "agent_identity.json";

export type AgentIdentityStatus =
    | "not_configured"
    | "not_registered"
    | "registering"
    | "registered"
    | "needs_reconcile"
    | "failed";

export interface AgentIdentityRecord {
    walletSetId?: string | null;
    ownerWalletId?: string | null;
    ownerWalletAddress?: string | null;
    validatorWalletId?: string | null;
    validatorWalletAddress?: string | null;
    metadataUri?: string | null;
    agentId?: string | null;
    identityStatus: AgentIdentityStatus;
    registrationTxId?: string | null;
    registrationTxHash?: string | null;
    reputationStatus?: string | null;
    validationStatus?: string | null;
    lastSyncedAt?: number | null;
    version: number;
}

const DEFAULT_RECORD: AgentIdentityRecord = {
    walletSetId: null,
    ownerWalletId: null,
    ownerWalletAddress: null,
    validatorWalletId: null,
    validatorWalletAddress: null,
    metadataUri: null,
    agentId: null,
    identityStatus: "not_configured",
    registrationTxId: null,
    registrationTxHash: null,
    reputationStatus: null,
    validationStatus: null,
    lastSyncedAt: null,
    version: 1
};

export class AgentIdentityStore {
    private record: AgentIdentityRecord;

    constructor() {
        const raw = loadStore<Record<string, AgentIdentityRecord>>(AGENT_IDENTITY_FILE);
        this.record = {
            ...DEFAULT_RECORD,
            ...(raw.current || {})
        };
    }

    private persist(): void {
        saveStore(AGENT_IDENTITY_FILE, { current: this.record });
    }

    get(): AgentIdentityRecord {
        return { ...this.record };
    }

    set(updates: Partial<AgentIdentityRecord>): AgentIdentityRecord {
        this.record = {
            ...this.record,
            ...updates,
            version: this.record.version || 1
        };
        this.persist();
        return this.get();
    }

    clear(): void {
        this.record = { ...DEFAULT_RECORD };
        this.persist();
    }
}
