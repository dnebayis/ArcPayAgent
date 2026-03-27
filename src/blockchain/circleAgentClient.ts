import crypto from "crypto";
import {
    Blockchain,
    initiateDeveloperControlledWalletsClient
} from "@circle-fin/developer-controlled-wallets";
import { CircleTransactionState, CircleTransactionStatus } from "./circleClient";

export interface CreateAgentWalletsInput {
    walletSetId: string;
    count: number;
    blockchain?: string;
    accountType?: string;
}

export interface AgentWalletSet {
    walletSetId: string;
    name?: string | null;
    createDate?: string | null;
}

function normalizeSdkBaseUrl(baseUrl?: string): string | undefined {
    if (!baseUrl) {
        return undefined;
    }

    return baseUrl
        .replace(/\/v1\/w3s\/?$/i, "")
        .replace(/\/v1\/?$/i, "");
}

export class CircleAgentClient {
    private client;

    constructor(
        apiKey: string,
        entitySecret: string,
        baseUrl?: string
    ) {
        if (!apiKey || !entitySecret) {
            if (process.env.NODE_ENV === "test") {
                console.warn("[CircleAgentClient] Missing Circle credentials in test mode.");
            } else {
                throw new Error("Missing Circle credentials. Set CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET.");
            }
        }

        this.client = initiateDeveloperControlledWalletsClient({
            apiKey,
            entitySecret,
            baseUrl: normalizeSdkBaseUrl(baseUrl)
        });
    }

    async createWalletSet(name: string): Promise<{ walletSetId: string }> {
        const response = await this.client.createWalletSet({
            name,
            idempotencyKey: crypto.randomUUID()
        });
        const walletSetId = response.data?.walletSet?.id;
        if (!walletSetId) {
            throw new Error("Circle did not return a wallet set ID.");
        }

        return { walletSetId };
    }

    async createWallets(input: CreateAgentWalletsInput): Promise<Array<{ walletId: string; address: string }>> {
        const response = await this.client.createWallets({
            walletSetId: input.walletSetId,
            count: input.count,
            blockchains: [((input.blockchain || Blockchain.ArcTestnet) as Blockchain)],
            accountType: (input.accountType || "SCA") as any,
            idempotencyKey: crypto.randomUUID()
        });
        const wallets = response.data?.wallets || [];
        if (wallets.length === 0) {
            throw new Error("Circle did not return any wallets.");
        }

        return wallets.map((wallet) => ({
            walletId: wallet.id,
            address: wallet.address
        }));
    }

    async getWallet(walletId: string): Promise<{ walletId: string; address: string }> {
        const response = await this.client.getWallet({ id: walletId });
        const wallet = response.data?.wallet;
        if (!wallet?.id || !wallet.address) {
            throw new Error(`Wallet ${walletId} was not found.`);
        }

        return {
            walletId: wallet.id,
            address: wallet.address
        };
    }

    async listWalletSetByName(name: string): Promise<AgentWalletSet | null> {
        const response = await this.client.listWalletSets();
        const walletSets = (response.data?.walletSets || []) as Array<{ id: string; name?: string; createDate?: string }>;
        const match = walletSets.find((walletSet) => walletSet.name === name)
            || walletSets
                .slice()
                .sort((left, right) => new Date(right.createDate || 0).getTime() - new Date(left.createDate || 0).getTime())[0];

        if (!match?.id) {
            return null;
        }

        return {
            walletSetId: match.id,
            name: match.name || null,
            createDate: match.createDate || null
        };
    }

    async listWalletSets(): Promise<AgentWalletSet[]> {
        const response = await this.client.listWalletSets();
        const walletSets = (response.data?.walletSets || []) as Array<{ id: string; name?: string; createDate?: string }>;

        return walletSets.map((walletSet) => ({
            walletSetId: walletSet.id,
            name: walletSet.name || null,
            createDate: walletSet.createDate || null
        }));
    }

    async listWallets(walletSetId: string): Promise<Array<{ walletId: string; address: string }>> {
        const response = await this.client.listWallets({ walletSetId });
        const wallets = response.data?.wallets || [];
        return wallets
            .filter((wallet) => wallet.id && wallet.address)
            .map((wallet) => ({
                walletId: wallet.id,
                address: wallet.address
            }));
    }

    async createContractExecutionTransaction(
        walletAddress: string,
        contractAddress: string,
        abiFunctionSignature: string,
        abiParameters: unknown[],
        feeLevel: string = "MEDIUM"
    ): Promise<string> {
        const response = await this.client.createContractExecutionTransaction({
            walletAddress,
            blockchain: Blockchain.ArcTestnet,
            contractAddress,
            abiFunctionSignature,
            abiParameters,
            fee: {
                type: "level",
                config: {
                    feeLevel: feeLevel as any
                }
            },
            idempotencyKey: crypto.randomUUID()
        });
        const txId = response.data?.id;
        if (!txId) {
            throw new Error("Circle did not return a transaction ID.");
        }

        return txId;
    }

    async getTransaction(id: string): Promise<CircleTransactionStatus> {
        const response = await this.client.getTransaction({ id });
        const tx = response.data?.transaction;
        if (!tx) {
            throw new Error(`Transaction ${id} was not found.`);
        }

        return {
            id: tx.id || id,
            state: (tx.state || "UNKNOWN") as CircleTransactionState,
            txHash: tx.txHash || null,
            errorReason: tx.errorReason || null,
            errorDetails: tx.errorDetails || null
        };
    }

    async waitForTerminalTransaction(
        id: string,
        options: { attempts?: number; intervalMs?: number } = {}
    ): Promise<CircleTransactionStatus | null> {
        const attempts = options.attempts ?? 15;
        const intervalMs = options.intervalMs ?? 2000;

        for (let attempt = 0; attempt < attempts; attempt += 1) {
            const tx = await this.getTransaction(id);
            if (this.isTerminalState(tx.state)) {
                return tx;
            }

            if (attempt < attempts - 1) {
                await new Promise((resolve) => setTimeout(resolve, intervalMs));
            }
        }

        return null;
    }

    isSuccessfulTerminalState(state: CircleTransactionState): boolean {
        return state === "COMPLETE";
    }

    isFailedTerminalState(state: CircleTransactionState): boolean {
        return state === "FAILED" || state === "DENIED" || state === "CANCELLED";
    }

    private isTerminalState(state: CircleTransactionState): boolean {
        return this.isSuccessfulTerminalState(state) || this.isFailedTerminalState(state);
    }
}
