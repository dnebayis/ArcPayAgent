import { registerAction } from "./registry";
import { getCryptoPrices, getFxRate, getArcStats, formatLarge } from "../research/tools";
import { ARC_EXPLORER_URL, arcExplorerAddress } from "../constants";
import type { WalletStore } from "../store/wallets";

export interface ResearchActionDeps {
    wallets: WalletStore;
    provider: any;
    send: (chatId: number, text: string) => Promise<void>;
}

export function registerResearchActions(deps: ResearchActionDeps): void {
    registerAction("get_crypto_prices", async (chatId, params) => {
        const { symbols } = params;
        if (!symbols) {
            await deps.send(chatId, "Please specify which cryptocurrencies (e.g., BTC,ETH,SOL).");
            return;
        }

        const symbolList = (symbols as string).split(",").map((s: string) => s.trim().toUpperCase());

        try {
            const prices = await getCryptoPrices(symbolList);
            if (prices.length === 0) {
                await deps.send(chatId, "No price data found. Check the symbol and try again (e.g., BTC, ETH, SOL).");
                return;
            }

            if (prices.length === 1) {
                // Single coin — detailed card
                const p = prices[0];
                const sign = (p.change24h ?? 0) >= 0 ? "+" : "";
                const change = p.change24h !== null ? `${sign}${p.change24h.toFixed(2)}%` : "—";
                const lines = [
                    `${p.name} (${p.symbol})`,
                    ``,
                    `Price:     $${p.priceUsd.toLocaleString("en-US", { maximumFractionDigits: 4 })}`,
                    `24h:       ${change}`,
                    p.high24h ? `High 24h:  $${p.high24h.toLocaleString("en-US", { maximumFractionDigits: 4 })}` : null,
                    p.low24h  ? `Low 24h:   $${p.low24h.toLocaleString("en-US", { maximumFractionDigits: 4 })}` : null,
                    p.marketCapUsd ? `Market cap: ${formatLarge(p.marketCapUsd)}` : null,
                    p.volume24hUsd ? `Volume 24h: ${formatLarge(p.volume24hUsd)}` : null,
                ].filter(Boolean).join("\n");
                await deps.send(chatId, lines);
            } else {
                // Multi-coin — compact table
                const header = "Crypto Prices\n";
                const rows = prices.map(p => {
                    const price = `$${p.priceUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
                    const change = p.change24h !== null
                        ? ` ${p.change24h >= 0 ? "+" : ""}${p.change24h.toFixed(2)}%`
                        : "";
                    return `${p.symbol}: ${price}${change}`;
                });
                await deps.send(chatId, header + "\n" + rows.join("\n"));
            }
        } catch (err: any) {
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
            const result = await getFxRate(String(from), String(to), Number(amount) || 1);
            const amtStr = result.amount !== 1 ? `${result.amount} ${result.from}` : `1 ${result.from}`;
            const resultStr = result.amount !== 1
                ? `${result.result.toFixed(4)} ${result.to}`
                : `${result.rate.toFixed(4)} ${result.to}`;
            await deps.send(chatId, `${amtStr} = ${resultStr}`);
        } catch {
            await deps.send(chatId, "Failed to fetch exchange rate. Please try again.");
        }
    });

    registerAction("get_arc_network_stats", async (chatId) => {
        try {
            const stats = await getArcStats(deps.provider);
            await deps.send(chatId,
                `Arc Network\n\nLatest block: ${stats.latestBlock.toLocaleString()}\nChain ID: ${stats.chainId}\nExplorer: ${ARC_EXPLORER_URL}`
            );
        } catch {
            await deps.send(chatId, "Failed to fetch Arc network stats.");
        }
    });

    registerAction("get_my_arc_activity", async (chatId) => {
        const wallet = await deps.wallets.getWalletAddress(chatId);
        if (!wallet) {
            await deps.send(chatId, "You need a wallet first. Say \"create wallet\" to get started.");
            return;
        }
        await deps.send(chatId,
            `Arc Activity\n\nWallet: ${wallet}\n\nView on explorer:\n${arcExplorerAddress(wallet)}`
        );
    });
}
