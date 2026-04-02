import { logger } from "../utils/logger";
import type { WatchStore } from "../store/watch";
import type { TokenOps } from "../chain/tokens";
import type { Sender } from "../core/sender";
import { formatAmount } from "../utils/format";

export class WatcherService {
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(
        private watch: WatchStore,
        private tokens: TokenOps,
        private sender: Sender,
        private intervalMs: number = 30_000,
    ) {}

    start(): void {
        if (this.timer) return;
        logger.info(null, "[Watcher] Started", { intervalMs: this.intervalMs });

        this.timer = setInterval(() => this.tick().catch(err =>
            logger.error(null, "[Watcher] Tick error", { error: err.message })
        ), this.intervalMs);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            logger.info(null, "[Watcher] Stopped");
        }
    }

    private async tick(): Promise<void> {
        const enabled = await this.watch.getAllEnabled();
        if (enabled.length === 0) return;

        for (const { chatId, config } of enabled) {
            try {
                const usdcBal = await this.tokens.balanceOf("USDC", config.walletAddress);
                const eurcBal = await this.tokens.balanceOf("EURC", config.walletAddress);

                const usdcStr = usdcBal.toString();
                const eurcStr = eurcBal.toString();

                const prevUsdc = BigInt(config.lastUsdcBalance || "0");
                const prevEurc = BigInt(config.lastEurcBalance || "0");

                // Notify on increases (incoming payments)
                if (usdcBal > prevUsdc && prevUsdc > 0n) {
                    const diff = usdcBal - prevUsdc;
                    await this.sender.send(chatId, `Incoming payment detected: +${formatAmount(diff)} USDC\nNew balance: ${formatAmount(usdcBal)} USDC`);
                }
                if (eurcBal > prevEurc && prevEurc > 0n) {
                    const diff = eurcBal - prevEurc;
                    await this.sender.send(chatId, `Incoming payment detected: +${formatAmount(diff)} EURC\nNew balance: ${formatAmount(eurcBal)} EURC`);
                }

                await this.watch.updateBalances(chatId, usdcStr, eurcStr);
            } catch (err: any) {
                logger.warn(chatId, "[Watcher] Balance check failed", { error: err.message });
            }
        }
    }
}
