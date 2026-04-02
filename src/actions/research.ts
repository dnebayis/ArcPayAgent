import { registerAction } from "./registry";
import { getCryptoPrices, getFxRate, getArcStats } from "../research/tools";
import type { WalletStore } from "../store/wallets";
import type { ethers } from "ethers";

export interface ResearchActionDeps {
    wallets: WalletStore;
    provider: any; // ethers.Provider
    send: (chatId: number, text: string) => Promise<void>;
}

export function registerResearchActions(deps: ResearchActionDeps): void {
    registerAction("get_crypto_prices", async (chatId, params) => {
        const { symbols } = params;
        if (!symbols) {
            await deps.send(chatId, "Please specify which cryptocurrencies (e.g., BTC,ETH,SOL).");
            return;
        }

        const symbolList = symbols.split(",").map((s: string) => s.trim());

        try {
            const prices = await getCryptoPrices(symbolList);
            if (prices.length === 0) {
                await deps.send(chatId, "No price data found for those symbols.");
                return;
            }

            let text = "Crypto Prices\n\n";
            for (const p of prices) {
                const change = p.change24h !== null ? ` (${p.change24h >= 0 ? "+" : ""}${p.change24h.toFixed(2)}%)` : "";
                text += `${p.symbol}: $${p.priceUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}${change}\n`;
            }
            await deps.send(chatId, text);
        } catch {
            await deps.send(chatId, "Failed to fetch prices. Please try again.");
        }
    });

    registerAction("get_fx_rate", async (chatId, params) => {
        const { from, to, amount } = params;
        if (!from || !to) {
            await deps.send(chatId, "Please specify source and target currencies (e.g., EUR to USD).");
            return;
        }

        try {
            const result = await getFxRate(from, to, amount || 1);
            await deps.send(chatId, `${result.amount} ${result.from} = ${result.result.toFixed(4)} ${result.to}\nRate: 1 ${result.from} = ${result.rate.toFixed(4)} ${result.to}`);
        } catch {
            await deps.send(chatId, "Failed to fetch exchange rate. Please try again.");
        }
    });

    registerAction("get_arc_network_stats", async (chatId) => {
        try {
            const stats = await getArcStats(deps.provider);
            await deps.send(chatId, `Arc Network Stats\n\nLatest block: ${stats.latestBlock.toLocaleString()}\nChain ID: ${stats.chainId}`);
        } catch {
            await deps.send(chatId, "Failed to fetch Arc network stats.");
        }
    });

    registerAction("get_my_arc_activity", async (chatId) => {
        const wallet = await deps.wallets.getWalletAddress(chatId);
        if (!wallet) {
            await deps.send(chatId, "You need a wallet first.");
            return;
        }

        await deps.send(chatId, `Your Arc activity can be viewed at:\nhttps://testnet.arcscan.app/address/${wallet}`);
    });
}
