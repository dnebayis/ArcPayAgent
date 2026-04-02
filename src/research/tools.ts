import { logger } from "../utils/logger";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const HTTP_TIMEOUT = 8000;
const MAX_RETRIES = 2;

// Common symbol → CoinGecko ID mapping
const COIN_MAP: Record<string, string> = {
    BTC: "bitcoin", ETH: "ethereum", SOL: "solana", ADA: "cardano",
    DOT: "polkadot", AVAX: "avalanche-2", MATIC: "matic-network",
    LINK: "chainlink", UNI: "uniswap", AAVE: "aave",
    DOGE: "dogecoin", SHIB: "shiba-inu", XRP: "ripple",
    BNB: "binancecoin", NEAR: "near", ARB: "arbitrum",
    OP: "optimism", ATOM: "cosmos", FTM: "fantom",
    LTC: "litecoin", USDC: "usd-coin", USDT: "tether",
    DAI: "dai", EURC: "euro-coin", WBTC: "wrapped-bitcoin",
};

export interface PriceResult {
    symbol: string;
    priceUsd: number;
    change24h: number | null;
}

export interface FxResult {
    from: string;
    to: string;
    rate: number;
    amount: number;
    result: number;
}

export interface ArcStats {
    latestBlock: number;
    chainId: number;
}

async function fetchJson(url: string, retries = MAX_RETRIES): Promise<any> {
    for (let i = 0; i <= retries; i++) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT);
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeout);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (err: any) {
            if (i === retries) throw err;
            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
}

export async function getCryptoPrices(symbols: string[]): Promise<PriceResult[]> {
    const ids = symbols
        .map(s => COIN_MAP[s.toUpperCase()])
        .filter(Boolean);

    if (ids.length === 0) return [];

    const url = `${COINGECKO_BASE}/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_24hr_change=true`;
    const data = await fetchJson(url);

    const results: PriceResult[] = [];
    for (const symbol of symbols) {
        const id = COIN_MAP[symbol.toUpperCase()];
        if (!id || !data[id]) continue;
        results.push({
            symbol: symbol.toUpperCase(),
            priceUsd: data[id].usd ?? 0,
            change24h: data[id].usd_24h_change ?? null,
        });
    }
    return results;
}

export async function getFxRate(from: string, to: string, amount = 1): Promise<FxResult> {
    const fxBase = process.env.FX_API_BASE_URL || "https://api.frankfurter.dev/v1";
    const url = `${fxBase}/latest?from=${from.toUpperCase()}&to=${to.toUpperCase()}&amount=${amount}`;
    const data = await fetchJson(url);
    const rate = data.rates?.[to.toUpperCase()] ?? 0;
    return { from: from.toUpperCase(), to: to.toUpperCase(), rate: rate / amount, amount, result: rate };
}

export async function getArcStats(provider: any): Promise<ArcStats> {
    const blockNumber = await provider.getBlockNumber();
    const network = await provider.getNetwork();
    return { latestBlock: blockNumber, chainId: Number(network.chainId) };
}

export function resolveCoinId(symbol: string): string | null {
    return COIN_MAP[symbol.toUpperCase()] ?? null;
}
