import { logger } from "../utils/logger";
import { ethers } from "ethers";
import type { CircleClient } from "../chain/circle";
import type { ERC8004Client } from "../chain/erc8004";
import type { AgentIdentityStore, AgentIdentity } from "../store/identity";
import type { WalletStore } from "../store/wallets";
import { getConfig } from "../config";

export interface IdentityEngineDeps {
    circle: CircleClient;
    erc8004: ERC8004Client;
    identityStore: AgentIdentityStore;
    wallets: WalletStore;
    send: (chatId: number, text: string) => Promise<void>;
}

export class IdentityEngine {
    private deps: IdentityEngineDeps;

    constructor(deps: IdentityEngineDeps) {
        this.deps = deps;
    }

    async getStatus(chatId: number): Promise<void> {
        const identity = await this.deps.identityStore.get();
        if (!identity || identity.status === "not_configured") {
            await this.deps.send(chatId, "Agent identity is not configured. Set ARC_AGENT_METADATA_URI in your environment.");
            return;
        }

        const lines: string[] = ["Agent Status (ERC-8004)\n"];
        lines.push(`Status: ${identity.status}`);

        if (identity.agentId) lines.push(`Agent ID: ${identity.agentId}`);
        if (identity.ownerWalletAddress) {
            lines.push(`Owner: ${identity.ownerWalletAddress.slice(0, 6)}...${identity.ownerWalletAddress.slice(-4)}`);
        }
        if (identity.registrationTxHash) {
            lines.push(`Registration TX: https://testnet.arcscan.app/tx/${identity.registrationTxHash}`);
        }
        if (identity.validationStatus) {
            lines.push(`Validation: ${identity.validationStatus}`);
        }

        await this.deps.send(chatId, lines.join("\n"));
    }

    async getIdentity(chatId: number): Promise<void> {
        const identity = await this.deps.identityStore.get();
        if (!identity) {
            await this.deps.send(chatId, "No agent identity found.");
            return;
        }

        const config = getConfig();
        const lines: string[] = ["Agent Identity\n"];

        if (identity.ownerWalletAddress) lines.push(`Owner wallet: ${identity.ownerWalletAddress}`);
        if (identity.validatorWalletAddress) lines.push(`Validator wallet: ${identity.validatorWalletAddress}`);
        if (identity.metadataUri) lines.push(`Metadata URI: ${identity.metadataUri}`);
        if (identity.agentId) lines.push(`Agent ID: ${identity.agentId}`);
        lines.push(`Status: ${identity.status}`);

        if (identity.agentId) {
            try {
                const uri = await this.deps.erc8004.tokenUri(BigInt(identity.agentId));
                lines.push(`On-chain URI: ${uri}`);
            } catch {
                // Not registered or not accessible
            }
        }

        await this.deps.send(chatId, lines.join("\n"));
    }

    async getValidationStatus(chatId: number): Promise<void> {
        const identity = await this.deps.identityStore.get();
        if (!identity?.validationRequestHash) {
            await this.deps.send(chatId, "No validation request found for this agent.");
            return;
        }

        try {
            const status = await this.deps.erc8004.getValidationStatus(identity.validationRequestHash);
            const responseMap: Record<number, string> = { 0: "Pending", 1: "Approved", 2: "Rejected" };

            const lines: string[] = ["Validation Status\n"];
            lines.push(`Response: ${responseMap[status.response] || "Unknown"}`);
            lines.push(`Validator: ${status.validator.slice(0, 6)}...${status.validator.slice(-4)}`);
            if (status.tag) lines.push(`Tag: ${status.tag}`);
            if (status.lastUpdate > 0n) {
                lines.push(`Last update: block timestamp ${status.lastUpdate.toString()}`);
            }

            await this.deps.identityStore.updateField("validationStatus", responseMap[status.response] || "Unknown");
            await this.deps.send(chatId, lines.join("\n"));
        } catch (err: any) {
            logger.error(chatId, "[IdentityEngine] Validation status error", { error: err.message });
            await this.deps.send(chatId, "Failed to fetch validation status.");
        }
    }

    /**
     * Initialize agent identity on startup if configured.
     */
    async initialize(): Promise<void> {
        const config = getConfig();

        if (!config.ARC_AGENT_METADATA_URI) {
            logger.info(null, "[IdentityEngine] No metadata URI configured, skipping init");
            return;
        }

        let identity = await this.deps.identityStore.get();
        if (!identity) {
            identity = {
                status: "not_registered",
                metadataUri: config.ARC_AGENT_METADATA_URI,
                agentId: config.ARC_AGENT_ID,
            };
        }

        // Resolve owner wallet
        if (config.ARC_AGENT_OWNER_WALLET_ID && !identity.ownerWalletAddress) {
            try {
                const wallet = await this.deps.circle.getWallet(config.ARC_AGENT_OWNER_WALLET_ID);
                identity.ownerWalletId = config.ARC_AGENT_OWNER_WALLET_ID;
                identity.ownerWalletAddress = wallet.address;
            } catch (err: any) {
                logger.warn(null, "[IdentityEngine] Failed to resolve owner wallet", { error: err.message });
            }
        }

        // Resolve validator wallet
        if (config.ARC_AGENT_VALIDATOR_WALLET_ID && !identity.validatorWalletAddress) {
            try {
                const wallet = await this.deps.circle.getWallet(config.ARC_AGENT_VALIDATOR_WALLET_ID);
                identity.validatorWalletId = config.ARC_AGENT_VALIDATOR_WALLET_ID;
                identity.validatorWalletAddress = wallet.address;
            } catch (err: any) {
                logger.warn(null, "[IdentityEngine] Failed to resolve validator wallet", { error: err.message });
            }
        }

        // Check if already registered on-chain
        if (identity.ownerWalletAddress && !identity.agentId) {
            try {
                const agentId = await this.deps.erc8004.findAgentIdForOwner(identity.ownerWalletAddress);
                if (agentId !== null) {
                    identity.agentId = agentId.toString();
                    identity.status = "registered";
                }
            } catch {
                // Network error, will retry later
            }
        }

        if (identity.agentId) {
            identity.status = "registered";
        }

        identity.metadataUri = config.ARC_AGENT_METADATA_URI;
        identity.lastSyncedAt = Date.now();
        await this.deps.identityStore.save(identity);

        logger.info(null, "[IdentityEngine] Identity initialized", { status: identity.status });
    }
}
