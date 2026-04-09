import { registerAction } from "./registry";
import type { CircleClient } from "../chain/circle";
import type { TokenOps } from "../chain/tokens";
import type { WalletStore } from "../store/wallets";
import type { PaymentLogStore } from "../store/payments";
import type { ConversationMemory } from "../memory/conversation";
import { formatAmount } from "../utils/format";
import { arcExplorerAddress } from "../constants";
import { logger } from "../utils/logger";

export interface WalletActionDeps {
    circle: CircleClient;
    tokens: TokenOps;
    wallets: WalletStore;
    paymentLog: PaymentLogStore;
    memory: ConversationMemory;
    send: (chatId: number, text: string) => Promise<void>;
}

export function registerWalletActions(deps: WalletActionDeps): void {
    registerAction("create_wallet", async (chatId) => {
        const existing = await deps.wallets.hasWallet(chatId);
        if (existing) {
            await deps.send(chatId, "You already have a wallet. Use \"show wallet\" to see your details.");
            return;
        }

        await deps.send(chatId, "Creating your wallet...");

        try {
            const { walletId, address } = await deps.circle.createWallet();
            await deps.wallets.saveWallet(chatId, walletId, address);
            await deps.send(chatId, `Wallet created!\n\nAddress: ${address}\n\nYou can now receive USDC and EURC on Arc Testnet.`);
            logger.info(chatId, "[Wallet] Created", { walletId, address });
        } catch (err: any) {
            logger.error(chatId, "[Wallet] Creation failed", { error: err.message });
            await deps.send(chatId, "Wallet creation failed. Please try again.");
        }
    });

    registerAction("show_wallet", async (chatId) => {
        const wallet = await deps.wallets.getWallet(chatId);
        if (!wallet) {
            await deps.send(chatId, "No wallet found. Say \"create wallet\" to get started.");
            return;
        }

        let text = `Wallet\n\nAddress: ${wallet.address}`;
        try {
            const usdcBal = await deps.tokens.balanceOf("USDC", wallet.address);
            const eurcBal = await deps.tokens.balanceOf("EURC", wallet.address);
            text += `\n\nUSDC: ${formatAmount(usdcBal)}`;
            text += `\nEURC: ${formatAmount(eurcBal)}`;
        } catch {
            text += "\n\nBalance: unavailable (network error)";
        }

        await deps.send(chatId, text);
    });

    registerAction("export_wallet", async (chatId) => {
        const wallet = await deps.wallets.getWallet(chatId);
        if (!wallet) {
            await deps.send(chatId, "No wallet found.");
            return;
        }

        await deps.send(chatId,
            `Your wallet address: ${wallet.address}\n\n` +
            `This is a Circle Developer-Controlled Wallet. Private keys are managed by Circle's secure infrastructure and cannot be exported. ` +
            `You can use the wallet address above to receive funds from other wallets or exchanges.`
        );
    });

    registerAction("wallet_intelligence", async (chatId) => {
        const wallet = await deps.wallets.getWallet(chatId);
        if (!wallet) {
            await deps.send(chatId, "No wallet found. Say \"create wallet\" to get started.");
            return;
        }

        const parts: string[] = ["Portfolio Analysis\n"];

        // Balances
        try {
            const usdcBal = await deps.tokens.balanceOf("USDC", wallet.address);
            const eurcBal = await deps.tokens.balanceOf("EURC", wallet.address);
            parts.push(`USDC: ${formatAmount(usdcBal)}`);
            parts.push(`EURC: ${formatAmount(eurcBal)}`);

            const totalUsd = Number(formatAmount(usdcBal)) + Number(formatAmount(eurcBal));
            parts.push(`Total (approx): $${totalUsd.toFixed(2)}`);
        } catch {
            parts.push("Balances: unavailable");
        }

        // Payment activity
        const payments = await deps.paymentLog.getPayments(chatId);
        parts.push(`\nTotal transactions: ${payments.length}`);

        if (payments.length > 0) {
            const total = payments.reduce((s, p) => s + p.amount, 0);
            parts.push(`Total spent: $${total.toFixed(2)}`);

            // Monthly average
            if (payments.length >= 2) {
                const oldest = payments[0].timestamp;
                const months = Math.max(1, (Date.now() - oldest) / (30 * 24 * 60 * 60 * 1000));
                parts.push(`Monthly avg: $${(total / months).toFixed(2)}`);
            }

            // Last 30 days
            const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
            const recent = payments.filter(p => p.timestamp >= thirtyDaysAgo);
            parts.push(`Last 30 days: ${recent.length} txs, $${recent.reduce((s, p) => s + p.amount, 0).toFixed(2)}`);
        }

        parts.push(`\nWallet: ${wallet.address}`);
        parts.push(`Explorer: ${arcExplorerAddress(wallet.address)}`);

        await deps.send(chatId, parts.join("\n"));
    });
}
