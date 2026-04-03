import { logger } from "../utils/logger";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const HTTP_TIMEOUT = 10_000;
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
    SUI: "sui", APT: "aptos", INJ: "injective-protocol",
    TIA: "celestia", SEI: "sei-network", PYTH: "pyth-network",
    JUP: "jupiter-exchange-solana", WIF: "dogwifcoin",
    PEPE: "pepe", FLOKI: "floki", BONK: "bonk",
};

export interface PriceResult {
    symbol: string;
    name: string;
    priceUsd: number;
    change24h: number | null;
    marketCapUsd: number | null;
    volume24hUsd: number | null;
    high24h: number | null;
    low24h: number | null;
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

async function fetchJson(url: string, headers?: Record<string, string>, retries = MAX_RETRIES): Promise<any> {
    for (let i = 0; i <= retries; i++) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT);
            const res = await fetch(url, { signal: controller.signal, headers });
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
    const upper = symbols.map(s => s.toUpperCase());
    const ids = upper.map(s => COIN_MAP[s]).filter(Boolean);

    if (ids.length === 0) return [];

    // Use /coins/markets for richer data
    const url = `${COINGECKO_BASE}/coins/markets?vs_currency=usd&ids=${ids.join(",")}&order=market_cap_desc&sparkline=false&price_change_percentage=24h`;
    const data: any[] = await fetchJson(url);

    // Build id → market data map
    const byId = new Map(data.map(d => [d.id, d]));

    const results: PriceResult[] = [];
    for (const sym of upper) {
        const id = COIN_MAP[sym];
        if (!id) continue;
        const d = byId.get(id);
        if (!d) continue;
        results.push({
            symbol: sym,
            name: d.name,
            priceUsd: d.current_price ?? 0,
            change24h: d.price_change_percentage_24h ?? null,
            marketCapUsd: d.market_cap ?? null,
            volume24hUsd: d.total_volume ?? null,
            high24h: d.high_24h ?? null,
            low24h: d.low_24h ?? null,
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

/** Format large numbers: 1,234,567 → $1.23M */
export function formatLarge(n: number): string {
    if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
    return `$${n.toFixed(2)}`;
}
