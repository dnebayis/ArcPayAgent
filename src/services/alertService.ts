import TelegramBot from "node-telegram-bot-api";
import { AlertStore } from "../storage/alertStore";
import { ResearchTools } from "../tools/researchTools";

/**
 * Periodically checks crypto prices against user-defined thresholds.
 * Fires a Telegram notification when a price crosses the target level.
 */
export class AlertService {
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(
        private bot: TelegramBot,
        private alertStore: AlertStore,
        private researchTools: ResearchTools
    ) { }

    start(): void {
        console.log("[AlertService] Started — checking every 60s");
        this.timer = setInterval(() => void this.tick(), 60 * 1000);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            console.log("[AlertService] Stopped");
        }
    }

    private async tick(): Promise<void> {
        const active = this.alertStore.getAllActive();
        if (!active.length) return;

        // Deduplicate symbols to minimise API calls
        const symbols = [...new Set(active.map(a => a.symbol))];

        try {
            const data = await this.researchTools.fetch({ action: "get_crypto_prices", symbols });
            if (data.type !== "crypto_prices") return;

            const priceMap = new Map<string, number>();
            for (const p of data.prices) {
                if (p.price_usd !== null) {
                    priceMap.set(p.symbol.toUpperCase(), p.price_usd);
                }
            }

            for (const alert of active) {
                const currentPrice = priceMap.get(alert.symbol.toUpperCase());
                if (currentPrice === undefined) continue;

                const hit =
                    (alert.direction === "above" && currentPrice >= alert.targetPrice) ||
                    (alert.direction === "below" && currentPrice <= alert.targetPrice);

                if (!hit) continue;

                this.alertStore.markTriggered(alert.id);

                const dirWord = alert.direction === "above" ? "above" : "below";
                const currentFmt = currentPrice.toLocaleString("en-US", { maximumFractionDigits: 2 });
                const targetFmt = alert.targetPrice.toLocaleString("en-US", { maximumFractionDigits: 2 });

                const msg = `🔔 *Price Alert Triggered\\!*\n\n*${alert.symbol}* is now $${currentFmt} — ${dirWord} your target of $${targetFmt}\\.`;

                await this.bot.sendMessage(alert.chatId, msg, { parse_mode: "MarkdownV2" }).catch((err: Error) => {
                    console.error(`[AlertService] Failed to notify chatId=${alert.chatId}:`, err.message);
                });
            }
        } catch (error: any) {
            console.error("[AlertService] tick error:", error.message);
        }
    }
}
