import { ethers } from "ethers";

// --- ABI fragments ---
const IDENTITY_ABI = [
    "function register(string metadataUri) returns (uint256)",
    "function setAgentUri(uint256 agentId, string metadataUri)",
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function tokenURI(uint256 tokenId) view returns (string)",
    "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];

const REPUTATION_ABI = [
    "function giveFeedback(uint256 agentId, uint8 score, string category, string tag, string details, string metadataUri, string context, bytes32 feedbackHash)",
];

const VALIDATION_ABI = [
    "function validationRequest(address validator, uint256 agentId, string requestUri, bytes32 requestHash)",
    "function validationResponse(bytes32 requestHash, uint8 response, string details, bytes32 responseHash, string tag)",
    "function getValidationStatus(bytes32 requestHash) view returns (address validator, uint256 agentId, uint8 response, bytes32 responseHash, string tag, uint256 lastUpdate)",
];

export class ERC8004Client {
    private identity: ethers.Contract;
    private reputation: ethers.Contract;
    private validation: ethers.Contract;
    private provider: ethers.Provider;

    constructor(
        provider: ethers.Provider,
        identityAddr: string,
        reputationAddr: string,
        validationAddr: string
    ) {
        this.provider = provider;
        this.identity = new ethers.Contract(identityAddr, IDENTITY_ABI, provider);
        this.reputation = new ethers.Contract(reputationAddr, REPUTATION_ABI, provider);
        this.validation = new ethers.Contract(validationAddr, VALIDATION_ABI, provider);
    }

    // --- Encoding (for Circle contract execution) ---

    encodeRegister(metadataUri: string): { to: string; data: string } {
        return {
            to: this.identity.target as string,
            data: this.identity.interface.encodeFunctionData("register", [metadataUri]),
        };
    }

    encodeSetAgentUri(agentId: bigint, metadataUri: string): { to: string; data: string } {
        return {
            to: this.identity.target as string,
            data: this.identity.interface.encodeFunctionData("setAgentUri", [agentId, metadataUri]),
        };
    }

    encodeGiveFeedback(
        agentId: bigint, score: number, category: string, tag: string,
        details: string, metadataUri: string, context: string, feedbackHash: string
    ): { to: string; data: string } {
        return {
            to: this.reputation.target as string,
            data: this.reputation.interface.encodeFunctionData("giveFeedback", [
                agentId, score, category, tag, details, metadataUri, context, feedbackHash,
            ]),
        };
    }

    encodeValidationRequest(
        validator: string, agentId: bigint, requestUri: string, requestHash: string
    ): { to: string; data: string } {
        return {
            to: this.validation.target as string,
            data: this.validation.interface.encodeFunctionData("validationRequest", [
                validator, agentId, requestUri, requestHash,
            ]),
        };
    }

    encodeValidationResponse(
        requestHash: string, response: number, details: string, responseHash: string, tag: string
    ): { to: string; data: string } {
        return {
            to: this.validation.target as string,
            data: this.validation.interface.encodeFunctionData("validationResponse", [
                requestHash, response, details, responseHash, tag,
            ]),
        };
    }

    // --- Read methods ---

    async ownerOf(agentId: bigint): Promise<string> {
        return this.identity.ownerOf(agentId);
    }

    async tokenUri(agentId: bigint): Promise<string> {
        return this.identity.tokenURI(agentId);
    }

    async getValidationStatus(requestHash: string): Promise<{
        validator: string; agentId: bigint; response: number;
        responseHash: string; tag: string; lastUpdate: bigint;
    }> {
        const [validator, agentId, response, responseHash, tag, lastUpdate] =
            await this.validation.getValidationStatus(requestHash);
        return { validator, agentId, response, responseHash, tag, lastUpdate };
    }

    /**
     * Find the most recent agent ID registered by an owner address.
     */
    async findAgentIdForOwner(ownerAddr: string, blockWindow = 10000): Promise<bigint | null> {
        const latest = await this.provider.getBlockNumber();
        const fromBlock = Math.max(0, latest - blockWindow);

        const transferTopic = ethers.id("Transfer(address,address,uint256)");
        const zeroAddr = ethers.zeroPadValue(ethers.ZeroAddress, 32);
        const ownerPadded = ethers.zeroPadValue(ownerAddr.toLowerCase(), 32);

        const logs = await this.provider.getLogs({
            address: this.identity.target as string,
            topics: [transferTopic, zeroAddr, ownerPadded],
            fromBlock,
            toBlock: "latest",
        });

        if (logs.length === 0) return null;

        // Latest registration
        const lastLog = logs[logs.length - 1];
        const agentId = BigInt(lastLog.topics[3]);
        return agentId;
    }
}
