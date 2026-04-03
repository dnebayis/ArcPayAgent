import { Store } from "./base";

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

const NS = "identity";
const KEY = "global";

export class AgentIdentityStore {
    /**
     * Namespace : identity
     * Key pattern: "global"  (singleton)
     * Value type : AgentIdentity
     */
    constructor(private store: Store) {}

    async get(): Promise<AgentIdentity | null> {
        return this.store.get<AgentIdentity>(NS, KEY);
    }

    async save(identity: AgentIdentity): Promise<void> {
        await this.store.set(NS, KEY, identity);
    }

    async updateField<K extends keyof AgentIdentity>(field: K, value: AgentIdentity[K]): Promise<void> {
        const existing = await this.get();
        if (existing) {
            (existing as any)[field] = value;
            await this.store.set(NS, KEY, existing);
        }
    }
}
