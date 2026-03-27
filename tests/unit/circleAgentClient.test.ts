import { beforeEach, describe, expect, it, vi } from "vitest";
import { CircleAgentClient } from "../../src/blockchain/circleAgentClient";

const { sdkClient, initiateDeveloperControlledWalletsClient } = vi.hoisted(() => ({
    sdkClient: {
        createWalletSet: vi.fn(),
        createWallets: vi.fn(),
        getWallet: vi.fn(),
        createContractExecutionTransaction: vi.fn(),
        getTransaction: vi.fn()
    },
    initiateDeveloperControlledWalletsClient: vi.fn()
}));

initiateDeveloperControlledWalletsClient.mockImplementation(() => sdkClient);

vi.mock("@circle-fin/developer-controlled-wallets", () => ({
    Blockchain: {
        ArcTestnet: "ARC-TESTNET"
    },
    initiateDeveloperControlledWalletsClient
}));

describe("CircleAgentClient", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should normalize the Circle base URL for the SDK", async () => {
        sdkClient.createWalletSet.mockResolvedValue({
            data: {
                walletSet: {
                    id: "wallet-set-1"
                }
            }
        });

        const client = new CircleAgentClient("api-key", "a".repeat(64), "https://api.circle.com/v1/w3s");
        await client.createWalletSet("Arc Pay Agent ERC8004");

        expect(initiateDeveloperControlledWalletsClient).toHaveBeenCalledWith({
            apiKey: "api-key",
            entitySecret: "a".repeat(64),
            baseUrl: "https://api.circle.com"
        });
        expect(sdkClient.createWalletSet).toHaveBeenCalled();
    });

    it("should create a contract execution transaction with the SDK payload", async () => {
        sdkClient.createContractExecutionTransaction.mockResolvedValue({
            data: {
                id: "tx-1"
            }
        });

        const client = new CircleAgentClient("api-key", "a".repeat(64));
        const txId = await client.createContractExecutionTransaction(
            "0x00000000000000000000000000000000000000a1",
            "0x00000000000000000000000000000000000000b2",
            "register(string)",
            ["ipfs://agent"]
        );

        expect(txId).toBe("tx-1");
        expect(sdkClient.createContractExecutionTransaction).toHaveBeenCalledWith(
            expect.objectContaining({
                walletAddress: "0x00000000000000000000000000000000000000a1",
                blockchain: "ARC-TESTNET",
                contractAddress: "0x00000000000000000000000000000000000000b2",
                abiFunctionSignature: "register(string)",
                abiParameters: ["ipfs://agent"],
                fee: {
                    type: "level",
                    config: {
                        feeLevel: "MEDIUM"
                    }
                }
            })
        );
    });
});
