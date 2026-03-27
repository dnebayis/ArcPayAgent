import { ethers } from "ethers";
import { CircleAgentClient } from "../blockchain/circleAgentClient";
import { ERC8004Client } from "../blockchain/erc8004Client";
import { buildKycValidationRequestHash } from "./validationRequest";
import { AgentIdentityStatus, AgentIdentityStore } from "../storage/agentIdentityStore";

export interface AgentIdentityRuntimeConfig {
    metadataUri?: string;
    ownerWalletId?: string;
    validatorWalletId?: string;
    agentId?: string;
    walletSetName?: string;
}

export interface AgentIdentitySummary {
    configured: boolean;
    registered: boolean;
    identityStatus: string;
    metadataUri: string | null;
    agentId: string | null;
    ownerWalletAddress: string | null;
    validatorWalletAddress: string | null;
    registrationTxId: string | null;
    registrationTxHash: string | null;
    validationStatus: string | null;
    reputationStatus: string | null;
    needsReconcile: boolean;
    reason?: string;
}

interface ServiceWallets {
    walletSetId?: string | null;
    ownerWalletId: string;
    ownerWalletAddress: string;
    validatorWalletId: string;
    validatorWalletAddress: string;
}

export class AgentIdentityEngine {
    constructor(
        private circleClient: CircleAgentClient,
        private erc8004Client: ERC8004Client,
        private store: AgentIdentityStore,
        private config: AgentIdentityRuntimeConfig = {}
    ) { }

    private resolveMetadataUri(): string | null {
        return this.store.get().metadataUri || this.config.metadataUri || null;
    }

    private resolveIdentityStatus(): AgentIdentityStatus {
        const record = this.store.get();
        const configured = Boolean(this.resolveMetadataUri());

        if (!configured) {
            return "not_configured";
        }

        if (record.agentId && record.identityStatus === "registered") {
            return "registered";
        }

        if (record.identityStatus === "needs_reconcile" || record.identityStatus === "failed") {
            return record.identityStatus;
        }

        if (record.registrationTxId && record.identityStatus === "registering") {
            return "registering";
        }

        return "not_registered";
    }

    getStatus(): AgentIdentitySummary {
        const record = this.store.get();
        const metadataUri = this.resolveMetadataUri();
        const identityStatus = this.resolveIdentityStatus();
        const configured = Boolean(metadataUri);
        const registered = Boolean(record.agentId && identityStatus === "registered");
        const needsReconcile = identityStatus === "needs_reconcile";

        return {
            configured,
            registered,
            identityStatus,
            metadataUri,
            agentId: record.agentId || null,
            ownerWalletAddress: record.ownerWalletAddress || null,
            validatorWalletAddress: record.validatorWalletAddress || null,
            registrationTxId: record.registrationTxId || null,
            registrationTxHash: record.registrationTxHash || null,
            validationStatus: record.validationStatus || null,
            reputationStatus: record.reputationStatus || null,
            needsReconcile,
            reason: !configured ? "metadata_missing" : undefined
        };
    }

    async getStatusSummary(): Promise<string> {
        const status = this.getStatus();
        if (!status.configured) {
            return "Arc Pay Agent registration is not configured yet.";
        }
        if (!status.registered) {
            return "Arc Pay Agent is not registered on Arc yet.";
        }

        const reconcileNote = status.needsReconcile ? " Status needs reconciliation." : "";
        return `Arc Pay Agent is registered on Arc. Agent ID: ${status.agentId}.${reconcileNote}`;
    }

    private formatValidationLabel(value: string): string {
        return value
            .trim()
            .replace(/[_-]+/g, " ");
    }

    private extractValidationRequestHash(value?: string | null): string | null {
        if (!value) {
            return null;
        }
        if (value.startsWith("requested:") || value.startsWith("responded:")) {
            return value.slice(value.indexOf(":") + 1) || null;
        }
        return null;
    }

    private async resolveOnchainValidationStatus(agentId: string, fallbackStatus?: string | null): Promise<string | null> {
        const currentRequestHash = this.extractValidationRequestHash(fallbackStatus);
        const candidateHashes = [
            buildKycValidationRequestHash(agentId),
            currentRequestHash
        ].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);

        for (const requestHash of candidateHashes) {
            try {
                const validation = await this.erc8004Client.getValidationStatus(requestHash);
                if (validation.tag) {
                    return validation.response > 0 ? `responded:${requestHash}` : `requested:${requestHash}`;
                }
            } catch {
                // Ignore registry read errors and continue to the next candidate hash.
            }
        }

        return fallbackStatus || null;
    }

    private async refreshValidationStatus(agentId?: string | null): Promise<string | null> {
        if (!agentId) {
            return this.store.get().validationStatus || null;
        }

        const current = this.store.get();
        const nextValidationStatus = await this.resolveOnchainValidationStatus(agentId, current.validationStatus);
        if (nextValidationStatus !== current.validationStatus) {
            this.store.set({
                validationStatus: nextValidationStatus,
                lastSyncedAt: Date.now()
            });
        }
        return nextValidationStatus;
    }

    async getValidationSummary(): Promise<string> {
        const status = this.getStatus();
        if (!status.configured) {
            return "Arc Pay Agent does not have onchain validation configured yet.";
        }
        if (!status.registered) {
            return "Arc Pay Agent is not registered on Arc yet, so there is no validation record to show.";
        }
        const effectiveValidationStatus = await this.resolveOnchainValidationStatus(
            status.agentId || "",
            status.validationStatus
        );
        if (effectiveValidationStatus?.startsWith("requested:") || effectiveValidationStatus?.startsWith("responded:")) {
            const requestHash = effectiveValidationStatus.slice(effectiveValidationStatus.indexOf(":") + 1);
            if (requestHash) {
                try {
                    const validation = await this.erc8004Client.getValidationStatus(requestHash);
                    if (validation.tag) {
                        const normalizedTag = this.formatValidationLabel(validation.tag);
                        if (validation.response > 0) {
                            return `Arc Pay Agent validation status: ${normalizedTag}.`;
                        }
                        return `Arc Pay Agent validation request is onchain with tag ${normalizedTag}, but no positive response is recorded yet.`;
                    }
                } catch {
                    // Fall through to stored summary if the registry read is unavailable.
                }
            }
        }
        return effectiveValidationStatus
            ? `Arc Pay Agent validation status: ${this.formatValidationLabel(effectiveValidationStatus)}.`
            : "Arc Pay Agent has no onchain validation record yet.";
    }

    async getIdentityDetails(): Promise<Record<string, unknown>> {
        const status = this.getStatus();
        return {
            ...status,
            addresses: this.erc8004Client.addresses
        };
    }

    private ensureMetadataUri(): string {
        const metadataUri = this.resolveMetadataUri();
        if (!metadataUri) {
            throw new Error("ARC_AGENT_METADATA_URI is required to register Arc Pay Agent.");
        }
        return metadataUri;
    }

    private ensureConfiguredOverrides(): void {
        const ownerId = this.config.ownerWalletId;
        const validatorId = this.config.validatorWalletId;
        if ((ownerId && !validatorId) || (!ownerId && validatorId)) {
            throw new Error("ARC_AGENT_OWNER_WALLET_ID and ARC_AGENT_VALIDATOR_WALLET_ID must be provided together.");
        }
    }

    private async ensureServiceWallets(): Promise<ServiceWallets> {
        this.ensureConfiguredOverrides();
        const current = this.store.get();
        if (current.ownerWalletId && current.ownerWalletAddress && current.validatorWalletId && current.validatorWalletAddress) {
            return {
                walletSetId: current.walletSetId,
                ownerWalletId: current.ownerWalletId,
                ownerWalletAddress: current.ownerWalletAddress,
                validatorWalletId: current.validatorWalletId,
                validatorWalletAddress: current.validatorWalletAddress
            };
        }

        if (this.config.ownerWalletId && this.config.validatorWalletId) {
            const [owner, validator] = await Promise.all([
                this.circleClient.getWallet(this.config.ownerWalletId),
                this.circleClient.getWallet(this.config.validatorWalletId)
            ]);
            this.store.set({
                ownerWalletId: owner.walletId,
                ownerWalletAddress: owner.address,
                validatorWalletId: validator.walletId,
                validatorWalletAddress: validator.address,
                metadataUri: current.metadataUri || this.config.metadataUri || null,
                identityStatus: current.identityStatus === "registered" ? current.identityStatus : "not_registered",
                lastSyncedAt: Date.now()
            });
            return {
                ownerWalletId: owner.walletId,
                ownerWalletAddress: owner.address,
                validatorWalletId: validator.walletId,
                validatorWalletAddress: validator.address
            };
        }

        const walletSet = await this.circleClient.createWalletSet(
            this.config.walletSetName || "Arc Pay Agent ERC8004"
        );
        const wallets = await this.circleClient.createWallets({
            walletSetId: walletSet.walletSetId,
            count: 2,
            blockchain: "ARC-TESTNET",
            accountType: "SCA"
        });
        if (wallets.length < 2) {
            throw new Error("Circle did not return both owner and validator wallets.");
        }
        const [owner, validator] = wallets;

        this.store.set({
            walletSetId: walletSet.walletSetId,
            ownerWalletId: owner.walletId,
            ownerWalletAddress: owner.address,
            validatorWalletId: validator.walletId,
            validatorWalletAddress: validator.address,
            metadataUri: current.metadataUri || this.config.metadataUri || null,
            identityStatus: "not_registered",
            lastSyncedAt: Date.now()
        });

        return {
            walletSetId: walletSet.walletSetId,
            ownerWalletId: owner.walletId,
            ownerWalletAddress: owner.address,
            validatorWalletId: validator.walletId,
            validatorWalletAddress: validator.address
        };
    }

    async recoverRegistration(): Promise<AgentIdentitySummary> {
        if (this.config.ownerWalletId) {
            const ownerWallet = await this.circleClient.getWallet(this.config.ownerWalletId);
            let agentId = this.config.agentId || null;

            if (agentId) {
                const ownerOfAgent = await this.erc8004Client.ownerOf(agentId);
                if (ownerOfAgent.toLowerCase() !== ownerWallet.address.toLowerCase()) {
                    throw new Error(`Configured ARC_AGENT_ID ${agentId} is not owned by wallet ${ownerWallet.address}.`);
                }
            } else {
                agentId = await this.erc8004Client.findLatestAgentIdForOwner(ownerWallet.address);
            }

            if (agentId) {
                const validatorWallet = this.config.validatorWalletId
                    ? await this.circleClient.getWallet(this.config.validatorWalletId)
                    : null;
                const metadataUri = await this.erc8004Client.tokenUri(agentId);

                this.store.set({
                    ownerWalletId: ownerWallet.walletId,
                    ownerWalletAddress: ownerWallet.address,
                    validatorWalletId: validatorWallet?.walletId || null,
                    validatorWalletAddress: validatorWallet?.address || null,
                    metadataUri,
                    agentId,
                    identityStatus: "registered",
                    lastSyncedAt: Date.now()
                });

                await this.refreshValidationStatus(agentId);
                return this.getStatus();
            }
        }

        const walletSetName = this.config.walletSetName || "Arc Pay Agent ERC8004";
        const preferredWalletSet = await this.circleClient.listWalletSetByName(walletSetName);
        const allWalletSets = await this.circleClient.listWalletSets();
        const orderedWalletSets = [
            ...(preferredWalletSet ? [preferredWalletSet] : []),
            ...allWalletSets.filter((walletSet) => walletSet.walletSetId !== preferredWalletSet?.walletSetId)
        ];

        let matchedWalletSet: { walletSetId: string } | null = null;
        let matchedWallets: Array<{ walletId: string; address: string }> = [];
        let ownerWallet: { walletId: string; address: string } | null = null;
        let agentId: string | null = null;

        for (const walletSet of orderedWalletSets) {
            const wallets = await this.circleClient.listWallets(walletSet.walletSetId);
            if (!wallets.length) {
                continue;
            }

            for (const wallet of wallets) {
                const candidateAgentId = await this.erc8004Client.findLatestAgentIdForOwner(wallet.address);
                if (candidateAgentId) {
                    matchedWalletSet = walletSet;
                    matchedWallets = wallets;
                    ownerWallet = wallet;
                    agentId = candidateAgentId;
                    break;
                }
            }

            if (ownerWallet && agentId) {
                break;
            }
        }

        if (!matchedWalletSet || !ownerWallet || !agentId) {
            throw new Error("No registered Arc Pay Agent owner wallet could be found in any accessible Circle wallet set.");
        }

        const validatorWallet = matchedWallets.find((wallet) => wallet.walletId !== ownerWallet!.walletId) || null;
        const metadataUri = await this.erc8004Client.tokenUri(agentId);

        this.store.set({
            walletSetId: matchedWalletSet.walletSetId,
            ownerWalletId: ownerWallet.walletId,
            ownerWalletAddress: ownerWallet.address,
            validatorWalletId: validatorWallet?.walletId || null,
            validatorWalletAddress: validatorWallet?.address || null,
            metadataUri,
            agentId,
            identityStatus: "registered",
            lastSyncedAt: Date.now()
        });

        await this.refreshValidationStatus(agentId);
        return this.getStatus();
    }

    async syncRegistration(): Promise<AgentIdentitySummary> {
        const current = this.store.get();
        if (!current.agentId || !current.ownerWalletAddress) {
            return this.getStatus();
        }

        try {
            const [owner, tokenUri] = await Promise.all([
                this.erc8004Client.ownerOf(current.agentId),
                this.erc8004Client.tokenUri(current.agentId)
            ]);
            const metadataUri = current.metadataUri || this.config.metadataUri || null;
            const ownerMatches = owner.toLowerCase() === current.ownerWalletAddress.toLowerCase();
            const metadataMatches = !metadataUri || tokenUri === metadataUri;

            this.store.set({
                identityStatus: ownerMatches && metadataMatches ? "registered" : "needs_reconcile",
                registrationTxHash: current.registrationTxHash || null,
                lastSyncedAt: Date.now(),
                metadataUri: tokenUri || metadataUri
            });
        } catch {
            this.store.set({
                identityStatus: "needs_reconcile",
                lastSyncedAt: Date.now()
            });
        }

        if (current.agentId) {
            await this.refreshValidationStatus(current.agentId);
        }
        return this.getStatus();
    }

    async registerAgent(): Promise<AgentIdentitySummary> {
        const metadataUri = this.ensureMetadataUri();
        const current = this.store.get();
        if (current.agentId && current.ownerWalletAddress) {
            const synced = await this.syncRegistration();
            if (synced.registered) {
                return synced;
            }
        }

        const wallets = await this.ensureServiceWallets();
        let txId: string | null = null;
        try {
            txId = await this.circleClient.createContractExecutionTransaction(
                wallets.ownerWalletAddress,
                this.erc8004Client.addresses.identityRegistry,
                "register(string)",
                [metadataUri]
            );

            this.store.set({
                metadataUri,
                registrationTxId: txId,
                identityStatus: "registering",
                lastSyncedAt: Date.now()
            });
        } catch (error) {
            this.store.set({
                metadataUri,
                walletSetId: wallets.walletSetId || current.walletSetId || null,
                ownerWalletId: wallets.ownerWalletId,
                ownerWalletAddress: wallets.ownerWalletAddress,
                validatorWalletId: wallets.validatorWalletId,
                validatorWalletAddress: wallets.validatorWalletAddress,
                identityStatus: "failed",
                registrationTxId: null,
                registrationTxHash: null,
                lastSyncedAt: Date.now()
            });
            throw error;
        }

        const finalTx = await this.circleClient.waitForTerminalTransaction(txId, {
            attempts: Number.parseInt(process.env.CIRCLE_TX_POLL_ATTEMPTS || "", 10) || 30,
            intervalMs: Number.parseInt(process.env.CIRCLE_TX_POLL_INTERVAL_MS || "", 10) || 2000
        });

        if (!finalTx) {
            this.store.set({
                identityStatus: "failed",
                registrationTxId: txId,
                lastSyncedAt: Date.now()
            });
            throw new Error("Arc agent registration timed out.");
        }

        if (!this.circleClient.isSuccessfulTerminalState(finalTx.state)) {
            this.store.set({
                identityStatus: "failed",
                registrationTxHash: finalTx.txHash,
                lastSyncedAt: Date.now()
            });
            throw new Error(finalTx.errorReason || "Arc agent registration failed.");
        }

        const agentId = await this.erc8004Client.findLatestAgentIdForOwner(wallets.ownerWalletAddress);
        if (!agentId) {
            this.store.set({
                identityStatus: "needs_reconcile",
                registrationTxHash: finalTx.txHash,
                lastSyncedAt: Date.now()
            });
            throw new Error("Registration completed, but the agent ID could not be resolved from chain logs.");
        }

        this.store.set({
            walletSetId: wallets.walletSetId || current.walletSetId || null,
            ownerWalletId: wallets.ownerWalletId,
            ownerWalletAddress: wallets.ownerWalletAddress,
            validatorWalletId: wallets.validatorWalletId,
            validatorWalletAddress: wallets.validatorWalletAddress,
            metadataUri,
            agentId,
            identityStatus: "registered",
            registrationTxId: finalTx.id,
            registrationTxHash: finalTx.txHash,
            lastSyncedAt: Date.now()
        });

        await this.refreshValidationStatus(agentId);
        return this.getStatus();
    }

    async updateMetadata(metadataUri?: string): Promise<AgentIdentitySummary> {
        const nextMetadataUri = metadataUri || this.ensureMetadataUri();
        let current = this.store.get();

        if (!current.agentId || !current.ownerWalletAddress) {
            await this.recoverRegistration();
            current = this.store.get();
        }

        if (!current.agentId || !current.ownerWalletAddress) {
            throw new Error("Arc Pay Agent must be registered before updating metadata.");
        }

        const txId = await this.circleClient.createContractExecutionTransaction(
            current.ownerWalletAddress,
            this.erc8004Client.addresses.identityRegistry,
            "setAgentURI(uint256,string)",
            [current.agentId, nextMetadataUri]
        );

        const finalTx = await this.circleClient.waitForTerminalTransaction(txId, {
            attempts: Number.parseInt(process.env.CIRCLE_TX_POLL_ATTEMPTS || "", 10) || 30,
            intervalMs: Number.parseInt(process.env.CIRCLE_TX_POLL_INTERVAL_MS || "", 10) || 2000
        });

        if (!finalTx) {
            throw new Error("Arc agent metadata update timed out.");
        }

        if (!this.circleClient.isSuccessfulTerminalState(finalTx.state)) {
            throw new Error(finalTx.errorReason || "Arc agent metadata update failed.");
        }

        this.store.set({
            metadataUri: nextMetadataUri,
            lastSyncedAt: Date.now()
        });

        return await this.syncRegistration();
    }

    async recordReputation(score: string, tag: string): Promise<string> {
        const current = this.store.get();
        if (!current.agentId || !current.ownerWalletAddress || !current.validatorWalletAddress) {
            throw new Error("Arc Pay Agent must be registered before recording reputation.");
        }
        if (current.ownerWalletAddress.toLowerCase() === current.validatorWalletAddress.toLowerCase()) {
            throw new Error("Validator wallet cannot match the owner wallet.");
        }

        const feedbackHash = ethers.keccak256(ethers.toUtf8Bytes(tag));
        const txId = await this.circleClient.createContractExecutionTransaction(
            current.validatorWalletAddress,
            this.erc8004Client.addresses.reputationRegistry,
            "giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)",
            [current.agentId, score, "0", tag, "", "", "", feedbackHash]
        );
        this.store.set({
            reputationStatus: `submitted:${txId}`,
            lastSyncedAt: Date.now()
        });
        return txId;
    }

    async requestValidation(requestUri: string, requestHash: string): Promise<string> {
        const current = this.store.get();
        if (!current.agentId || !current.ownerWalletAddress || !current.validatorWalletAddress) {
            throw new Error("Arc Pay Agent must be registered before requesting validation.");
        }

        const txId = await this.circleClient.createContractExecutionTransaction(
            current.ownerWalletAddress,
            this.erc8004Client.addresses.validationRegistry,
            "validationRequest(address,uint256,string,bytes32)",
            [current.validatorWalletAddress, current.agentId, requestUri, requestHash]
        );
        this.store.set({
            validationStatus: `requested:${requestHash}`,
            lastSyncedAt: Date.now()
        });
        return txId;
    }

    async respondValidation(requestHash: string, response: string, tag: string, responseHash?: string): Promise<string> {
        const current = this.store.get();
        if (!requestHash) {
            throw new Error("A validation request hash is required before Arc Pay Agent can write a validation response.");
        }
        if (!current.validatorWalletAddress) {
            throw new Error("ARC_AGENT_VALIDATOR_WALLET_ID is required before Arc Pay Agent can write a validation response.");
        }
        if (current.validationStatus?.startsWith("requested:")) {
            const expectedRequestHash = current.validationStatus.slice("requested:".length);
            if (expectedRequestHash && expectedRequestHash !== requestHash) {
                throw new Error(`Validation request hash mismatch. Expected ${expectedRequestHash}, received ${requestHash}.`);
            }
        }

        const txId = await this.circleClient.createContractExecutionTransaction(
            current.validatorWalletAddress,
            this.erc8004Client.addresses.validationRegistry,
            "validationResponse(bytes32,uint8,string,bytes32,string)",
            [requestHash, response, "", responseHash || ethers.ZeroHash, tag]
        );
        this.store.set({
            validationStatus: `responded:${requestHash}`,
            lastSyncedAt: Date.now()
        });
        return txId;
    }
}
