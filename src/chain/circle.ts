import { logger } from "../utils/logger";
import crypto from "crypto";

export interface TxResult {
    id: string;
    state: "COMPLETE" | "FAILED" | "DENIED" | "CANCELLED" | "PENDING";
    txHash: string | null;
    errorReason: string | null;
}

export interface TokenBalance {
    token: string;
    amount: string;
}

const TERMINAL_STATES = new Set(["COMPLETE", "FAILED", "DENIED", "CANCELLED"]);
const DEFAULT_POLL_ATTEMPTS = 15;
const DEFAULT_POLL_INTERVAL_MS = 2000;

export class CircleClient {
    private client: any;
    private entitySecret: string;
    private walletSetId: string;

    constructor(apiKey: string, entitySecret: string, walletSetId: string, baseUrl?: string) {
        this.entitySecret = entitySecret;
        this.walletSetId = walletSetId;

        // Use Circle's Developer Controlled Wallets SDK
        const { initiateDeveloperControlledWalletsClient } = require("@circle-fin/developer-controlled-wallets");
        this.client = initiateDeveloperControlledWalletsClient({
            apiKey,
            entitySecret,
        });
    }

    /**
     * Encrypt entity secret with Circle's public RSA key.
     */
    private async getEntitySecretCiphertext(): Promise<string> {
        const response = await this.client.getPublicKey({});
        const publicKey = response.data?.publicKey;
        if (!publicKey) throw new Error("Failed to get Circle public key");

        const encrypted = crypto.publicEncrypt(
            { key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
            Buffer.from(this.entitySecret, "hex")
        );
        return encrypted.toString("base64");
    }

    async createWallet(): Promise<{ walletId: string; address: string }> {
        const ciphertext = await this.getEntitySecretCiphertext();
        const response = await this.client.createWallets({
            accountType: "SCA",
            blockchains: ["ARC-TESTNET"],
            count: 1,
            walletSetId: this.walletSetId,
            entitySecretCiphertext: ciphertext,
        });

        const wallet = response.data?.wallets?.[0];
        if (!wallet?.id || !wallet?.address) throw new Error("Wallet creation failed");
        return { walletId: wallet.id, address: wallet.address };
    }

    async submitTx(
        walletId: string,
        contractAddress: string,
        callData: string,
        idempotencyKey?: string
    ): Promise<string> {
        const ciphertext = await this.getEntitySecretCiphertext();
        const response = await this.client.createContractExecutionTransaction({
            walletId,
            contractAddress,
            callData,
            fee: { type: "level", config: { feeLevel: "MEDIUM" } },
            entitySecretCiphertext: ciphertext,
            idempotencyKey: idempotencyKey || crypto.randomUUID(),
        });

        const txId = response.data?.id;
        if (!txId) throw new Error("Transaction submission failed");
        return txId;
    }

    async getTx(id: string): Promise<TxResult> {
        const response = await this.client.getTransaction({ id });
        const tx = response.data?.transaction;
        if (!tx) throw new Error(`Transaction ${id} not found`);
        return {
            id: tx.id,
            state: TERMINAL_STATES.has(tx.state) ? tx.state : "PENDING",
            txHash: tx.txHash || null,
            errorReason: tx.errorReason || null,
        };
    }

    async pollTx(
        txId: string,
        opts?: { attempts?: number; intervalMs?: number }
    ): Promise<TxResult> {
        const attempts = opts?.attempts ?? DEFAULT_POLL_ATTEMPTS;
        const interval = opts?.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;

        for (let i = 0; i < attempts; i++) {
            const result = await this.getTx(txId);
            if (result.state !== "PENDING") return result;
            if (i < attempts - 1) {
                await new Promise(r => setTimeout(r, interval));
            }
        }

        logger.warn(null, "[Circle] Poll timed out", { txId, attempts, interval });
        return { id: txId, state: "PENDING", txHash: null, errorReason: "Poll timed out" };
    }

    async getBalance(walletId: string): Promise<TokenBalance[]> {
        const response = await this.client.getWalletTokenBalance({ id: walletId });
        const balances = response.data?.tokenBalances || [];
        return balances.map((b: any) => ({
            token: b.token?.symbol || "UNKNOWN",
            amount: b.amount || "0",
        }));
    }

    async getWallet(walletId: string): Promise<{ address: string; id: string }> {
        const response = await this.client.getWallet({ id: walletId });
        const w = response.data?.wallet;
        if (!w) throw new Error(`Wallet ${walletId} not found`);
        return { id: w.id, address: w.address };
    }

    async listTransactions(walletIds: string[]): Promise<any[]> {
        const response = await this.client.listTransactions({
            walletIds: walletIds.join(","),
        });
        return response.data?.transactions || [];
    }
}
