import dotenv from "dotenv";
import { ethers } from "ethers";
import { loadRuntimeConfig } from "../src/config";
import { CircleAgentClient } from "../src/blockchain/circleAgentClient";
import { ERC8004Client } from "../src/blockchain/erc8004Client";
import { AgentIdentityStore } from "../src/storage/agentIdentityStore";
import { AgentIdentityEngine } from "../src/engines/agentIdentityEngine";
import { initializePersistence } from "../src/storage/persistence";

dotenv.config();

export async function buildAgentIdentityRuntime() {
    await initializePersistence();
    const config = loadRuntimeConfig(process.env, { isTest: process.env.NODE_ENV === "test" });
    const provider = new ethers.JsonRpcProvider(config.ARC_RPC_URL);
    const circleAgentClient = new CircleAgentClient(
        config.CIRCLE_API_KEY,
        config.CIRCLE_ENTITY_SECRET,
        config.CIRCLE_API_URL
    );
    const erc8004Client = new ERC8004Client(provider, {
        identityRegistry: config.ERC8004_IDENTITY_REGISTRY_ADDRESS,
        reputationRegistry: config.ERC8004_REPUTATION_REGISTRY_ADDRESS,
        validationRegistry: config.ERC8004_VALIDATION_REGISTRY_ADDRESS
    });
    const store = new AgentIdentityStore();
    const engine = new AgentIdentityEngine(circleAgentClient, erc8004Client, store, {
        metadataUri: config.ARC_AGENT_METADATA_URI,
        ownerWalletId: config.ARC_AGENT_OWNER_WALLET_ID,
        validatorWalletId: config.ARC_AGENT_VALIDATOR_WALLET_ID,
        agentId: config.ARC_AGENT_ID,
        walletSetName: config.ARC_AGENT_WALLET_SET_NAME
    });

    return { config, provider, circleAgentClient, erc8004Client, store, engine };
}
