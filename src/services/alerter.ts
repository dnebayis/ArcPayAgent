import { logger } from "../utils/logger";
import type { AlertStore } from "../store/alerts";
import type { Sender } from "../core/sender";
import { getCryptoPrices, resolveCoinId } from "../research/tools";

export class AlerterService {
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(
        private alerts: AlertStore,
        private sender: Sender,
        private intervalMs: number = 60_000,
    ) {}

    start(): void {
        if (this.timer) return;
        logger.info(null, "[Alerter] Started", { intervalMs: this.intervalMs });

        this.timer = setInterval(() => this.tick().catch(err =>
            logger.error(null, "[Alerter] Tick error", { error: err.message })
        ), this.intervalMs);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            logger.info(null, "[Alerter] Stopped");
        }
    }

    private async tick(): Promise<void> {
        const active = await this.alerts.getAllActiveAlerts();
        if (active.length === 0) return;

        // Collect unique symbols
        const symbols = [...new Set(active.map(a => a.alert.symbol))];
        const supported = symbols.filter(s => resolveCoinId(s) !== null);

        if (supported.length === 0) return;

        try {
            const prices = await getCryptoPrices(supported);
            const priceMap = new Map(prices.map(p => [p.symbol, p.priceUsd]));

            for (const { chatId, alert } of active) {
                const price = priceMap.get(alert.symbol);
                if (price === undefined) continue;

                const triggered =
                    (alert.direction === "above" && price >= alert.targetPrice) ||
                    (alert.direction === "below" && price <= alert.targetPrice);

                if (triggered) {
                    await this.alerts.markTriggered(chatId, alert.id);
                    await this.sender.send(chatId,
                        `Price Alert Triggered!\n\n${alert.symbol} is now $${price.toLocaleString("en-US", { maximumFractionDigits: 2 })} (${alert.direction} $${alert.targetPrice.toLocaleString()})`,
                    );
                    logger.info(chatId, "[Alerter] Alert triggered", { symbol: alert.symbol, price });
                }
            }
        } catch (err: any) {
            logger.warn(null, "[Alerter] Price fetch failed", { error: err.message });
        }
    }
}
