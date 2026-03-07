import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";

export class CircleClient {
    private baseUrl: string;

    constructor(
        private apiKey: string,
        private entitySecret: string,
        private walletSetId: string,
        baseUrl?: string
    ) {
        if (!apiKey || !entitySecret || !walletSetId) {
            console.warn("[CircleClient] Missing Circle credentials in Config. Ensure CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, and CIRCLE_WALLET_SET_ID are set.");
        }
        this.baseUrl = baseUrl || "https://api.circle.com/v1/w3s";
    }

    private async request(method: string, endpoint: string, body?: any): Promise<any> {
        const url = `${this.baseUrl}${endpoint}`;
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.apiKey}`
        };

        const config: RequestInit = { method, headers };
        if (body) {
            config.body = JSON.stringify(body);
        }

        const response = await fetch(url, config);
        const json = await response.json();

        if (!response.ok) {
            throw new Error(`Circle API Error: ${json.message || JSON.stringify(json)}`);
        }

        return json.data;
    }

    private async getEntitySecretCiphertext(): Promise<string> {
        const data = await this.request("GET", "/config/entity/publicKey");
        const publicKey = data.publicKey;

        const entitySecretBuffer = Buffer.from(this.entitySecret, "hex");
        const encrypted = crypto.publicEncrypt(
            {
                key: publicKey,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: "sha256",
            },
            entitySecretBuffer
        );
        return encrypted.toString("base64");
    }

    async createWallet(): Promise<{ walletId: string, address: string }> {
        const cipherText = await this.getEntitySecretCiphertext();
        const idempotencyKey = uuidv4();

        const data = await this.request("POST", "/developer/wallets", {
            idempotencyKey,
            entitySecretCiphertext: cipherText,
            blockchains: ["ARC-TESTNET"],
            count: 1,
            walletSetId: this.walletSetId
        });

        const wallet = data.wallets[0];
        return {
            walletId: wallet.id,
            address: wallet.address
        };
    }

    async getWallet(walletId: string): Promise<{ walletId: string, address: string }> {
        const data = await this.request("GET", `/developer/wallets/${walletId}`);
        return {
            walletId: data.wallet.id,
            address: data.wallet.address
        };
    }

    async createTransaction(walletId: string, to: string, encodedData: string): Promise<string> {
        const cipherText = await this.getEntitySecretCiphertext();
        const idempotencyKey = uuidv4();

        const exactUserPayload = {
            idempotencyKey,
            entitySecretCiphertext: cipherText,
            walletId,
            contractAddress: to,
            callData: encodedData,
            feeLevel: "MEDIUM"
        };

        const res = await this.request("POST", "/developer/transactions/contractExecution", exactUserPayload);
        return res.id; // Usually returns transaction ID
    }

    async getTransaction(id: string): Promise<any> {
        return await this.request("GET", `/transactions/${id}`);
    }

    async getWalletBalance(walletId: string): Promise<any> {
        return await this.request("GET", `/developer/wallets/${walletId}/balances`);
    }

    async getWalletTransactions(walletId: string): Promise<any> {
        return await this.request("GET", `/developer/transactions?walletIds=${walletId}&pageSize=50`);
    }
}

