import { ethers } from "ethers";

export interface ERC8004Addresses {
    identityRegistry: string;
    reputationRegistry: string;
    validationRegistry: string;
}

export interface ValidationStatus {
    validatorAddress: string;
    agentId: string;
    response: number;
    responseHash: string;
    tag: string;
    lastUpdate: string;
}

const DEFAULT_ERC8004_ADDRESSES: ERC8004Addresses = {
    identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    validationRegistry: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272"
};

const identityInterface = new ethers.Interface([
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function tokenURI(uint256 tokenId) view returns (string)",
    "function register(string metadataURI)",
    "function setAgentURI(uint256 agentId,string newURI)",
    "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
]);

const validationInterface = new ethers.Interface([
    "function getValidationStatus(bytes32 requestHash) view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string tag, uint256 lastUpdate)",
    "function validationRequest(address validator,uint256 agentId,string requestURI,bytes32 requestHash)",
    "function validationResponse(bytes32 requestHash,uint8 response,string details,bytes32 responseHash,string tag)"
]);

const reputationInterface = new ethers.Interface([
    "function giveFeedback(uint256 agentId,int128 score,uint8 category,string tag,string details,string metadataURI,string context,bytes32 feedbackHash)"
]);

export class ERC8004Client {
    readonly addresses: ERC8004Addresses;

    constructor(
        private provider: ethers.Provider,
        addresses?: Partial<ERC8004Addresses>
    ) {
        const sanitizedAddresses = Object.fromEntries(
            Object.entries(addresses || {}).filter(([, value]) => Boolean(value))
        ) as Partial<ERC8004Addresses>;
        this.addresses = {
            ...DEFAULT_ERC8004_ADDRESSES,
            ...sanitizedAddresses
        };
    }

    encodeRegister(metadataUri: string): string {
        return identityInterface.encodeFunctionData("register", [metadataUri]);
    }

    encodeSetAgentUri(agentId: string, metadataUri: string): string {
        return identityInterface.encodeFunctionData("setAgentURI", [agentId, metadataUri]);
    }

    encodeGiveFeedback(
        agentId: string,
        score: string,
        category: string,
        tag: string,
        details = "",
        metadataUri = "",
        context = "",
        feedbackHash: string
    ): string {
        return reputationInterface.encodeFunctionData("giveFeedback", [
            agentId,
            score,
            category,
            tag,
            details,
            metadataUri,
            context,
            feedbackHash
        ]);
    }

    encodeValidationRequest(validatorAddress: string, agentId: string, requestUri: string, requestHash: string): string {
        return validationInterface.encodeFunctionData("validationRequest", [
            validatorAddress,
            agentId,
            requestUri,
            requestHash
        ]);
    }

    encodeValidationResponse(requestHash: string, response: string, details: string, responseHash: string, tag: string): string {
        return validationInterface.encodeFunctionData("validationResponse", [
            requestHash,
            response,
            details,
            responseHash,
            tag
        ]);
    }

    async findLatestAgentIdForOwner(ownerAddress: string, blockWindow = 10_000): Promise<string | null> {
        const latestBlock = await this.provider.getBlockNumber();
        const fromBlock = latestBlock > blockWindow ? latestBlock - blockWindow : 0;
        const transferTopic = ethers.id("Transfer(address,address,uint256)");
        const paddedOwner = ethers.zeroPadValue(ownerAddress as `0x${string}`, 32);
        const logs = await this.provider.getLogs({
            address: this.addresses.identityRegistry,
            topics: [transferTopic, null, paddedOwner],
            fromBlock,
            toBlock: latestBlock
        });

        if (!logs.length) {
            return null;
        }

        const parsed = identityInterface.parseLog(logs[logs.length - 1]);
        return parsed?.args?.tokenId?.toString?.() || null;
    }

    async ownerOf(agentId: string): Promise<string> {
        const contract = new ethers.Contract(this.addresses.identityRegistry, identityInterface, this.provider);
        return await contract.ownerOf(BigInt(agentId));
    }

    async tokenUri(agentId: string): Promise<string> {
        const contract = new ethers.Contract(this.addresses.identityRegistry, identityInterface, this.provider);
        return await contract.tokenURI(BigInt(agentId));
    }

    async getValidationStatus(requestHash: string): Promise<ValidationStatus> {
        const contract = new ethers.Contract(this.addresses.validationRegistry, validationInterface, this.provider);
        const [validatorAddress, agentId, response, responseHash, tag, lastUpdate] =
            await contract.getValidationStatus(requestHash);

        return {
            validatorAddress,
            agentId: agentId.toString(),
            response: Number(response),
            responseHash,
            tag,
            lastUpdate: lastUpdate.toString()
        };
    }
}
