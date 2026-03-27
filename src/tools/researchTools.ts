import { ethers } from "ethers";
import { RouterReader } from "../blockchain/routerReader";

export interface CryptoPriceData {
    symbol: string;
    price_usd: number | null;
    price_change_24h_pct: number | null;
}

export interface ArcNetworkStats {
    latestBlock: number | null;
    networkName: string;
}

export interface UserArcActivity {
    walletAddress: string | null;
    totalTxCount: number;
    recentTxCount: number;
    txList: { hash: string; timestamp: number; direction: "in" | "out" }[];
}

export interface FxRateData {
    from: string;
    to: string;
    amount: number;
    result: number;
    date: string;
}

export type ResearchData =
    | { type: "crypto_prices"; prices: CryptoPriceData[] }
    | { type: "arc_network_stats"; stats: ArcNetworkStats }
    | { type: "user_arc_activity"; activity: UserArcActivity }
    | { type: "fx_rate"; fx: FxRateData }
    | { type: "error"; message: string };

export interface ResearchIntent {
    action: string;
    symbols?: string[];
    [key: string]: unknown;
}

const RESEARCH_ACTIONS = ["get_crypto_prices", "get_arc_network_stats", "get_my_arc_activity", "get_fx_rate"] as const;
type ResearchAction = typeof RESEARCH_ACTIONS[number];

export class ResearchTools {
    constructor(
        private provider: ethers.Provider,
        private routerReader: RouterReader,
        private routerAddress: string
    ) { }

    isResearchAction(action: string): action is ResearchAction {
        return (RESEARCH_ACTIONS as readonly string[]).includes(action);
    }

    async fetch(intent: ResearchIntent, walletAddress?: string | null): Promise<ResearchData> {
        try {
            switch (intent.action as ResearchAction) {
                case "get_crypto_prices":
                    return await this.getCryptoPrices(intent.symbols || ["bitcoin", "ethereum"]);
                case "get_arc_network_stats":
                    return await this.getArcNetworkStats();
                case "get_my_arc_activity":
                    return await this.getUserArcActivity(walletAddress);
                case "get_fx_rate":
                    return await this.getFxRate(
                        String(intent.from || "USD").toUpperCase(),
                        String(intent.to || "USD").toUpperCase(),
                        Number(intent.amount ?? 1)
                    );
                default:
                    return { type: "error", message: `Unknown research action: ${intent.action}` };
            }
        } catch (error: any) {
            console.error(`[ResearchTools] fetch error for ${intent.action}:`, error.message);
            return { type: "error", message: error.message || "Research query failed" };
        }
    }

    /**
     * Retries a failing async operation with linear backoff.
     * Only retries on network/timeout errors — 4xx responses are not retried.
     */
    private async withRetry<T>(fn: () => Promise<T>, maxAttempts = 2, baseDelayMs = 1000): Promise<T> {
        let lastError: unknown;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await fn();
            } catch (err: any) {
                lastError = err;
                const isClientError = /\b4\d{2}\b/.test(err?.message ?? ""); // 4xx — permanent, don't retry
                if (attempt < maxAttempts && !isClientError) {
                    await new Promise(r => setTimeout(r, baseDelayMs * attempt));
                } else {
                    break;
                }
            }
        }
        throw lastError;
    }

    private async getCryptoPrices(symbols: string[]): Promise<ResearchData> {
        const coinIds = symbols
            .map(s => this.normalizeCoinId(s.toLowerCase()))
            .filter(Boolean)
            .join(",");

        if (!coinIds) {
            return { type: "crypto_prices", prices: [] };
        }

        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds}&vs_currencies=usd&include_24hr_change=true`;

        const doFetch = async () => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            try {
                const response = await fetch(url, { signal: controller.signal });
                clearTimeout(timeout);
                if (!response.ok) throw new Error(`CoinGecko API error: ${response.status}`);
                return await response.json() as Record<string, { usd?: number; usd_24h_change?: number }>;
            } catch (err) {
                clearTimeout(timeout);
                throw err;
            }
        };

        const data = await this.withRetry(doFetch);

        const prices: CryptoPriceData[] = symbols.map(symbol => {
            const id = this.normalizeCoinId(symbol.toLowerCase());
            const entry = id ? data[id] : null;
            return {
                symbol: symbol.toUpperCase(),
                price_usd: entry?.usd ?? null,
                price_change_24h_pct: entry?.usd_24h_change ?? null
            };
        });

        return { type: "crypto_prices", prices };
    }

    private async getArcNetworkStats(): Promise<ResearchData> {
        const latestBlock = await this.provider.getBlockNumber().catch(() => null);
        return {
            type: "arc_network_stats",
            stats: {
                latestBlock,
                networkName: "Arc Testnet"
            }
        };
    }

    private async getUserArcActivity(walletAddress?: string | null): Promise<ResearchData> {
        if (!walletAddress) {
            return {
                type: "user_arc_activity",
                activity: { walletAddress: null, totalTxCount: 0, recentTxCount: 0, txList: [] }
            };
        }

        try {
            const latestBlock = await this.provider.getBlockNumber();
            const chunkSize = 8000;
            const startBlock = Math.max(0, latestBlock - chunkSize + 1);

            const events = await this.routerReader.getRouterEvents(
                walletAddress.toLowerCase(),
                startBlock,
                latestBlock
            );

            const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
            const recentEvents = events.filter(e => e.timestamp > oneWeekAgo);

            const txList = events.slice(0, 10).map(e => ({
                hash: e.transactionHash,
                timestamp: e.timestamp,
                direction: (e.sender.toLowerCase() === walletAddress.toLowerCase() ? "out" : "in") as "in" | "out"
            }));

            return {
                type: "user_arc_activity",
                activity: {
                    walletAddress,
                    totalTxCount: events.length,
                    recentTxCount: recentEvents.length,
                    txList
                }
            };
        } catch {
            return {
                type: "user_arc_activity",
                activity: { walletAddress, totalTxCount: 0, recentTxCount: 0, txList: [] }
            };
        }
    }

    private async getFxRate(from: string, to: string, amount: number): Promise<ResearchData> {
        const url = `https://api.frankfurter.app/latest?from=${from}&to=${to}&amount=${amount}`;

        const doFetch = async () => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            try {
                const response = await fetch(url, { signal: controller.signal });
                clearTimeout(timeout);
                if (!response.ok) throw new Error(`Frankfurter API error: ${response.status}`);
                return await response.json() as { amount: number; base: string; date: string; rates: Record<string, number> };
            } catch (err) {
                clearTimeout(timeout);
                throw err;
            }
        };

        const data = await this.withRetry(doFetch);
        const result = data.rates[to];

        if (result === undefined) {
            throw new Error(`Currency ${to} not found in FX response`);
        }

        return {
            type: "fx_rate",
            fx: { from, to, amount, result, date: data.date }
        };
    }

    private normalizeCoinId(input: string): string {
        const mapping: Record<string, string> = {
            "btc": "bitcoin",
            "bitcoin": "bitcoin",
            "eth": "ethereum",
            "ethereum": "ethereum",
            "usdc": "usd-coin",
            "usd-coin": "usd-coin",
            "sol": "solana",
            "solana": "solana",
            "bnb": "binancecoin",
            "binance": "binancecoin",
            "ada": "cardano",
            "cardano": "cardano",
            "dot": "polkadot",
            "polkadot": "polkadot",
            "avax": "avalanche-2",
            "avalanche": "avalanche-2",
            "matic": "matic-network",
            "pol": "matic-network",
            "polygon": "matic-network",
            "link": "chainlink",
            "chainlink": "chainlink",
            "atom": "cosmos",
            "cosmos": "cosmos",
            "uni": "uniswap",
            "uniswap": "uniswap",
            "comp": "compound-governance-token",
            "compound": "compound-governance-token",
            "aave": "aave",
            "mkr": "maker",
            "maker": "maker",
            "snx": "havven",
            "synthetix": "havven",
            "crv": "curve-dao-token",
            "curve": "curve-dao-token",
            "sushi": "sushi",
            "sushiswap": "sushi",
            "ldo": "lido-dao",
            "lido": "lido-dao",
            "op": "optimism",
            "optimism": "optimism",
            "arb": "arbitrum",
            "arbitrum": "arbitrum",
            "arc": "arc", // placeholder — CoinGecko may not have Arc Testnet
        };

        return mapping[input] || input;
    }

    /** Format research data for LLM synthesis prompt */
    static formatForLLM(data: ResearchData): string {
        if (data.type === "error") {
            return `Error fetching data: ${data.message}`;
        }

        if (data.type === "crypto_prices") {
            const lines = data.prices.map(p => {
                if (p.price_usd === null) return `${p.symbol}: price unavailable (not found on CoinGecko)`;
                const change = p.price_change_24h_pct !== null
                    ? ` (${p.price_change_24h_pct >= 0 ? "+" : ""}${p.price_change_24h_pct.toFixed(2)}% 24h)`
                    : "";
                return `${p.symbol}: $${p.price_usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}${change}`;
            });
            return `Live crypto prices:\n${lines.join("\n")}`;
        }

        if (data.type === "arc_network_stats") {
            const { stats } = data;
            return `Arc Network Stats:\nNetwork: ${stats.networkName}\nLatest block: ${stats.latestBlock ?? "unavailable"}`;
        }

        if (data.type === "fx_rate") {
            const { fx } = data;
            const formatted = fx.result.toLocaleString("en-US", { maximumFractionDigits: 4 });
            return `FX rate (ECB, ${fx.date}):\n${fx.amount} ${fx.from} = ${formatted} ${fx.to}`;
        }

        if (data.type === "user_arc_activity") {
            const { activity } = data;
            const arcscanLink = activity.walletAddress
                ? `ArcScan: https://testnet.arcscan.app/address/${activity.walletAddress}`
                : "No wallet configured.";
            return `Your Arc on-chain activity:\n${arcscanLink}\nTotal transactions (recent window): ${activity.totalTxCount}\nTransactions this week: ${activity.recentTxCount}`;
        }

        return "No data available.";
    }
}
