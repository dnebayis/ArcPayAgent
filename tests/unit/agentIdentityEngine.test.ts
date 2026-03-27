import { describe, expect, it, vi } from "vitest";
import { AgentIdentityEngine } from "../../src/engines/agentIdentityEngine";
import { buildKycValidationRequestHash } from "../../src/engines/validationRequest";

describe("AgentIdentityEngine", () => {
    function createStore(record: Record<string, unknown>) {
        let current = {
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
            version: 1,
            ...record
        };

        return {
            get: vi.fn(() => ({ ...current })),
            set: vi.fn((updates: Record<string, unknown>) => {
                current = { ...current, ...updates };
                return { ...current };
            })
        };
    }

    it("should report not configured when metadata is missing", async () => {
        const store = createStore({});
        const engine = new AgentIdentityEngine(
            {} as any,
            {} as any,
            store as any,
            {}
        );

        const status = engine.getStatus();
        expect(status.configured).toBe(false);
        expect(await engine.getStatusSummary()).toContain("not configured");
    });

    it("should report not registered when metadata exists but no tx has started", () => {
        const store = createStore({
            identityStatus: "not_configured"
        });
        const engine = new AgentIdentityEngine(
            {} as any,
            {} as any,
            store as any,
            { metadataUri: "ipfs://agent" }
        );

        const status = engine.getStatus();
        expect(status.identityStatus).toBe("not_registered");
        expect(status.registered).toBe(false);
    });

    it("should surface registered identity details", async () => {
        const store = createStore({
            identityStatus: "registered",
            metadataUri: "ipfs://agent",
            agentId: "42",
            ownerWalletAddress: "0x00000000000000000000000000000000000000ab",
            validatorWalletAddress: "0x00000000000000000000000000000000000000cd",
            registrationTxId: "tx-1",
            registrationTxHash: "0xhash",
            validationStatus: "validated",
            reputationStatus: "trusted"
        });
        const engine = new AgentIdentityEngine(
            {} as any,
            {
                addresses: {
                    identityRegistry: "0x1",
                    reputationRegistry: "0x2",
                    validationRegistry: "0x3"
                }
            } as any,
            store as any,
            { metadataUri: "ipfs://agent" }
        );

        const details = await engine.getIdentityDetails();
        expect(details.agentId).toBe("42");
        expect(details.addresses).toBeDefined();
        expect(await engine.getStatusSummary()).toBe("Arc Pay Agent is registered on Arc. Agent ID: 42.");
        expect(await engine.getValidationSummary()).toBe("Arc Pay Agent validation status: validated.");
    });

    it("should resolve responded validation status from the registry tag", async () => {
        const store = createStore({
            identityStatus: "registered",
            metadataUri: "ipfs://agent",
            agentId: "40",
            validationStatus: "responded:0xrequest"
        });
        const engine = new AgentIdentityEngine(
            {} as any,
            {
                getValidationStatus: vi.fn().mockResolvedValue({
                    validatorAddress: "0x00000000000000000000000000000000000000cd",
                    agentId: "40",
                    response: 100,
                    responseHash: "0xhash",
                    tag: "service_verified",
                    lastUpdate: "123"
                })
            } as any,
            store as any,
            { metadataUri: "ipfs://agent" }
        );

        expect(await engine.getValidationSummary()).toBe("Arc Pay Agent validation status: service verified.");
    });

    it("should derive the KYC validation hash when local validation status is missing", async () => {
        const store = createStore({
            identityStatus: "registered",
            metadataUri: "ipfs://agent",
            agentId: "40",
            validationStatus: null
        });
        const kycRequestHash = buildKycValidationRequestHash("40");
        const getValidationStatus = vi.fn().mockImplementation(async (requestHash: string) => {
            if (requestHash !== kycRequestHash) {
                throw new Error("unexpected request hash");
            }
            return {
                validatorAddress: "0x00000000000000000000000000000000000000cd",
                agentId: "40",
                response: 100,
                responseHash: "0xhash",
                tag: "kyc_verified",
                lastUpdate: "123"
            };
        });
        const engine = new AgentIdentityEngine(
            {} as any,
            {
                getValidationStatus
            } as any,
            store as any,
            { metadataUri: "ipfs://agent" }
        );

        expect(await engine.getValidationSummary()).toBe("Arc Pay Agent validation status: kyc verified.");
        expect(getValidationStatus).toHaveBeenCalledWith(kycRequestHash);
    });

    it("should create a wallet set and two service wallets before registration", async () => {
        const store = createStore({});
        const circleAgentClient = {
            createWalletSet: vi.fn().mockResolvedValue({ walletSetId: "wallet-set-1" }),
            createWallets: vi.fn().mockResolvedValue([
                { walletId: "owner-wallet", address: "0x00000000000000000000000000000000000000a1" },
                { walletId: "validator-wallet", address: "0x00000000000000000000000000000000000000b2" }
            ]),
            createContractExecutionTransaction: vi.fn().mockResolvedValue("tx-1"),
            waitForTerminalTransaction: vi.fn().mockResolvedValue({
                id: "tx-1",
                state: "COMPLETE",
                txHash: "0xhash",
                errorReason: null,
                errorDetails: null
            }),
            isSuccessfulTerminalState: vi.fn().mockReturnValue(true)
        };
        const engine = new AgentIdentityEngine(
            circleAgentClient as any,
            {
                addresses: {
                    identityRegistry: "0x1"
                },
                findLatestAgentIdForOwner: vi.fn().mockResolvedValue("42")
            } as any,
            store as any,
            {
                metadataUri: "ipfs://agent",
                walletSetName: "Arc Pay Agent ERC8004"
            }
        );

        const status = await engine.registerAgent();

        expect(circleAgentClient.createWalletSet).toHaveBeenCalledWith("Arc Pay Agent ERC8004");
        expect(circleAgentClient.createWallets).toHaveBeenCalledWith({
            walletSetId: "wallet-set-1",
            count: 2,
            blockchain: "ARC-TESTNET",
            accountType: "SCA"
        });
        expect(circleAgentClient.createContractExecutionTransaction).toHaveBeenCalled();
        expect(status.identityStatus).toBe("registered");
        expect(status.agentId).toBe("42");
    });

    it("should update metadata for a registered agent", async () => {
        const store = createStore({
            identityStatus: "registered",
            metadataUri: "ipfs://old-agent",
            agentId: "40",
            ownerWalletAddress: "0x00000000000000000000000000000000000000a1"
        });
        const circleAgentClient = {
            createContractExecutionTransaction: vi.fn().mockResolvedValue("tx-update-1"),
            waitForTerminalTransaction: vi.fn().mockResolvedValue({
                id: "tx-update-1",
                state: "COMPLETE",
                txHash: "0xupdate",
                errorReason: null,
                errorDetails: null
            }),
            isSuccessfulTerminalState: vi.fn().mockReturnValue(true)
        };
        const engine = new AgentIdentityEngine(
            circleAgentClient as any,
            {
                addresses: {
                    identityRegistry: "0x1",
                    reputationRegistry: "0x2",
                    validationRegistry: "0x3"
                },
                ownerOf: vi.fn().mockResolvedValue("0x00000000000000000000000000000000000000a1"),
                tokenUri: vi.fn().mockResolvedValue("ipfs://updated-agent")
            } as any,
            store as any,
            { metadataUri: "ipfs://updated-agent" }
        );

        const status = await engine.updateMetadata("ipfs://updated-agent");

        expect(circleAgentClient.createContractExecutionTransaction).toHaveBeenCalledWith(
            "0x00000000000000000000000000000000000000a1",
            "0x1",
            "setAgentURI(uint256,string)",
            ["40", "ipfs://updated-agent"]
        );
        expect(status.metadataUri).toBe("ipfs://updated-agent");
        expect(status.identityStatus).toBe("registered");
    });

    it("should recover registration from Circle wallet set and chain", async () => {
        const store = createStore({});
        const circleAgentClient = {
            listWalletSetByName: vi.fn().mockResolvedValue({ walletSetId: "wallet-set-1", name: "Arc Pay Agent ERC8004" }),
            listWalletSets: vi.fn().mockResolvedValue([
                { walletSetId: "wallet-set-1", name: "Arc Pay Agent ERC8004" }
            ]),
            listWallets: vi.fn().mockResolvedValue([
                { walletId: "owner-wallet", address: "0x00000000000000000000000000000000000000a1" },
                { walletId: "validator-wallet", address: "0x00000000000000000000000000000000000000b2" }
            ])
        };
        const engine = new AgentIdentityEngine(
            circleAgentClient as any,
            {
                findLatestAgentIdForOwner: vi
                    .fn()
                    .mockResolvedValueOnce("40")
                    .mockResolvedValueOnce(null),
                tokenUri: vi.fn().mockResolvedValue("ipfs://recovered-agent")
            } as any,
            store as any,
            { walletSetName: "Arc Pay Agent ERC8004" }
        );

        const status = await engine.recoverRegistration();

        expect(circleAgentClient.listWalletSetByName).toHaveBeenCalledWith("Arc Pay Agent ERC8004");
        expect(circleAgentClient.listWalletSets).toHaveBeenCalled();
        expect(circleAgentClient.listWallets).toHaveBeenCalledWith("wallet-set-1");
        expect(status.agentId).toBe("40");
        expect(status.metadataUri).toBe("ipfs://recovered-agent");
        expect(status.registered).toBe(true);
    });

    it("should persist the KYC validation hash during registration recovery", async () => {
        const store = createStore({});
        const kycRequestHash = buildKycValidationRequestHash("40");
        const circleAgentClient = {
            listWalletSetByName: vi.fn().mockResolvedValue({ walletSetId: "wallet-set-1", name: "Arc Pay Agent ERC8004" }),
            listWalletSets: vi.fn().mockResolvedValue([
                { walletSetId: "wallet-set-1", name: "Arc Pay Agent ERC8004" }
            ]),
            listWallets: vi.fn().mockResolvedValue([
                { walletId: "owner-wallet", address: "0x00000000000000000000000000000000000000a1" },
                { walletId: "validator-wallet", address: "0x00000000000000000000000000000000000000b2" }
            ])
        };
        const engine = new AgentIdentityEngine(
            circleAgentClient as any,
            {
                findLatestAgentIdForOwner: vi
                    .fn()
                    .mockResolvedValueOnce("40")
                    .mockResolvedValueOnce(null),
                tokenUri: vi.fn().mockResolvedValue("ipfs://recovered-agent"),
                getValidationStatus: vi.fn().mockResolvedValue({
                    validatorAddress: "0x00000000000000000000000000000000000000b2",
                    agentId: "40",
                    response: 100,
                    responseHash: "0xhash",
                    tag: "kyc_verified",
                    lastUpdate: "123"
                })
            } as any,
            store as any,
            { walletSetName: "Arc Pay Agent ERC8004" }
        );

        const status = await engine.recoverRegistration();

        expect(status.validationStatus).toBe(`responded:${kycRequestHash}`);
        expect(store.set).toHaveBeenCalledWith(expect.objectContaining({
            validationStatus: `responded:${kycRequestHash}`
        }));
    });

    it("should recover registration directly from an owner wallet override", async () => {
        const store = createStore({});
        const circleAgentClient = {
            getWallet: vi.fn().mockResolvedValue({
                walletId: "owner-wallet",
                address: "0xa67ce2ea23de0c0d5a061a8774075f7d53d12856"
            })
        };
        const engine = new AgentIdentityEngine(
            circleAgentClient as any,
            {
                ownerOf: vi.fn().mockResolvedValue("0xa67ce2ea23de0c0d5a061a8774075f7d53d12856"),
                tokenUri: vi.fn().mockResolvedValue("ipfs://recovered-agent")
            } as any,
            store as any,
            {
                ownerWalletId: "4e5adf40-6c83-556a-9892-7e7e9c10d64a",
                agentId: "40"
            }
        );

        const status = await engine.recoverRegistration();

        expect(circleAgentClient.getWallet).toHaveBeenCalledWith("4e5adf40-6c83-556a-9892-7e7e9c10d64a");
        expect(status.agentId).toBe("40");
        expect(status.ownerWalletAddress).toBe("0xa67ce2ea23de0c0d5a061a8774075f7d53d12856");
        expect(status.registered).toBe(true);
    });

    it("should require a validator wallet before responding to validation", async () => {
        const store = createStore({
            identityStatus: "registered",
            agentId: "40",
            ownerWalletAddress: "0x00000000000000000000000000000000000000a1",
            validationStatus: "requested:0xrequest"
        });
        const engine = new AgentIdentityEngine(
            {} as any,
            {} as any,
            store as any,
            { metadataUri: "ipfs://agent" }
        );

        await expect(engine.respondValidation("0xrequest", "100", "service_verified"))
            .rejects
            .toThrow("ARC_AGENT_VALIDATOR_WALLET_ID is required");
    });

    it("should reject a mismatched validation request hash", async () => {
        const store = createStore({
            identityStatus: "registered",
            agentId: "40",
            validatorWalletAddress: "0x00000000000000000000000000000000000000b2",
            validationStatus: "requested:0xexpected"
        });
        const engine = new AgentIdentityEngine(
            {
                createContractExecutionTransaction: vi.fn()
            } as any,
            {} as any,
            store as any,
            { metadataUri: "ipfs://agent" }
        );

        await expect(engine.respondValidation("0xother", "100", "service_verified"))
            .rejects
            .toThrow("Validation request hash mismatch");
    });

    it("should write a validation response and store responded status", async () => {
        const store = createStore({
            identityStatus: "registered",
            agentId: "40",
            validatorWalletAddress: "0x00000000000000000000000000000000000000b2",
            validationStatus: "requested:0xrequest"
        });
        const circleAgentClient = {
            createContractExecutionTransaction: vi.fn().mockResolvedValue("tx-validation-1")
        };
        const engine = new AgentIdentityEngine(
            circleAgentClient as any,
            {
                addresses: {
                    validationRegistry: "0xvalidation"
                }
            } as any,
            store as any,
            { metadataUri: "ipfs://agent" }
        );

        const txId = await engine.respondValidation("0xrequest", "100", "service_verified", "0xhash");

        expect(txId).toBe("tx-validation-1");
        expect(circleAgentClient.createContractExecutionTransaction).toHaveBeenCalledWith(
            "0x00000000000000000000000000000000000000b2",
            "0xvalidation",
            "validationResponse(bytes32,uint8,string,bytes32,string)",
            ["0xrequest", "100", "", "0xhash", "service_verified"]
        );
        expect(store.set).toHaveBeenCalledWith(expect.objectContaining({
            validationStatus: "responded:0xrequest"
        }));
    });
});
