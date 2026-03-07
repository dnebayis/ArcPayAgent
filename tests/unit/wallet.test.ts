import { describe, it, expect, vi } from "vitest";
import { KeyVault } from "../../src/security/keyVault";
import { WalletStore } from "../../src/storage/walletStore";
import { ethers } from "ethers";

const mockCircleClient = {
    createWallet: vi.fn().mockResolvedValue({ walletId: "circle-wallet-123", address: "0x1234567890123456789012345678901234567890" })
} as any;

describe("KeyVault Encryption", () => {
    it("should encrypt and decrypt a private key correctly", () => {
        const secret = "test-secret-key-123";
        const wallet = ethers.Wallet.createRandom();
        const privateKey = wallet.privateKey;

        const encrypted = KeyVault.encryptPrivateKey(privateKey, secret);
        expect(encrypted).not.toBe(privateKey);
        expect(encrypted).toContain(":");

        const decrypted = KeyVault.decryptPrivateKey(encrypted, secret);
        expect(decrypted).toBe(privateKey);
    });

    it("should fail to decrypt with wrong secret", () => {
        const secret = "test-secret-key-123";
        const wrongSecret = "wrong-secret-key";
        const privateKey = "0x1234567890123456789012345678901234567890123456789012345678901234";

        const encrypted = KeyVault.encryptPrivateKey(privateKey, secret);
        expect(() => KeyVault.decryptPrivateKey(encrypted, wrongSecret)).toThrow();
    });
});

describe("WalletStore", () => {
    it("should create and store a wallet securely via Circle", async () => {
        const store = new WalletStore(mockCircleClient);
        const chatId = "123456789";

        expect(store.hasWallet(chatId)).toBe(false);

        const address = await store.createWallet(chatId);
        expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(store.hasWallet(chatId)).toBe(true);
        expect(store.getWalletAddress(chatId)).toBe(address);

        const walletId = store.getWalletId(chatId);
        expect(walletId).toBe("circle-wallet-123");
    });

    it("should prevent duplicate wallet creation per user", async () => {
        const store = new WalletStore(mockCircleClient);
        const chatId = "987654321";

        await store.createWallet(chatId);
        await expect(store.createWallet(chatId)).rejects.toThrow("Wallet already exists for this user");
    });

    it("should return null for non-existent wallet address", () => {
        const store = new WalletStore(mockCircleClient);
        expect(store.getWalletAddress("nonexistent")).toBeNull();
    });

    it("should return null for non-existent wallet id", () => {
        const store = new WalletStore(mockCircleClient);
        expect(store.getWalletId("nonexistent")).toBeNull();
    });
});
