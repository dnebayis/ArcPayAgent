export class FxRateService {
    constructor(
        private baseUrl: string = process.env.FX_API_BASE_URL || "https://api.frankfurter.dev/v1"
    ) { }

    async convertToUsd(amount: string, sourceCurrency: string): Promise<string | null> {
        const normalizedSource = sourceCurrency.toUpperCase();

        if (!amount || Number.isNaN(parseFloat(amount))) {
            return null;
        }

        if (normalizedSource === "USD" || normalizedSource === "USDC") {
            return parseFloat(amount).toFixed(2);
        }

        const params = new URLSearchParams({
            amount,
            from: normalizedSource,
            to: "USD"
        });

        const response = await fetch(`${this.baseUrl}/latest?${params.toString()}`);
        if (!response.ok) {
            throw new Error(`FX API error ${response.status}`);
        }

        const data = await response.json() as { rates?: Record<string, number> };
        const usdAmount = data.rates?.USD;

        if (typeof usdAmount !== "number" || Number.isNaN(usdAmount)) {
            return null;
        }

        return usdAmount.toFixed(2);
    }
}
