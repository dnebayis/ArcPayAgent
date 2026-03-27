import TelegramBot from "node-telegram-bot-api";
import { WatchStore, WatchSettings } from "../storage/watchStore";
import { USDC } from "../blockchain/usdc";

/**
 * Polls USDC and EURC balances for users who have enabled incoming payment
 * notifications. Sends a Telegram message when the balance increases.
 */
const CONSECUTIVE_FAILURE_WARN_THRESHOLD = 5; // ~2.5 minutes of failures before warning

export class WatchService {
    private timer: ReturnType<typeof setInterval> | null = null;
    /** Tracks consecutive RPC failures per chatId to surface persistent issues early */
    private consecutiveFailures = new Map<number, number>();

    constructor(
        private bot: TelegramBot,
        private watchStore: WatchStore,
        private usdc: USDC,
        private eurc: USDC
    ) { }

    start(): void {
        console.log("[WatchService] Started — polling every 30s");
        this.timer = setInterval(() => void this.tick(), 30 * 1000);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            console.log("[WatchService] Stopped");
        }
    }

    private async tick(): Promise<void> {
        const enabled = this.watchStore.getAllEnabled();
        if (!enabled.length) return;

        for (const settings of enabled) {
            try {
                await this.checkIncoming(settings);
                this.consecutiveFailures.delete(settings.chatId); // reset on success
            } catch (error: any) {
                const count = (this.consecutiveFailures.get(settings.chatId) ?? 0) + 1;
                this.consecutiveFailures.set(settings.chatId, count);
                console.error(`[WatchService] Error checking chatId=${settings.chatId} (failure #${count}):`, error.message);
                if (count === CONSECUTIVE_FAILURE_WARN_THRESHOLD) {
                    console.warn(`[WatchService] chatId=${settings.chatId} has failed ${count} consecutive checks — possible RPC or wallet issue`);
                }
            }
        }
    }

    private async checkIncoming(settings: WatchSettings): Promise<void> {
        const { chatId, walletAddress, lastKnownUsdcBalance, lastKnownEurcBalance } = settings;

        const [currentUsdc, currentEurc] = await Promise.all([
            this.usdc.balanceOf(walletAddress),
            this.eurc.balanceOf(walletAddress)
        ]);

        const prevUsdc = BigInt(lastKnownUsdcBalance);
        const prevEurc = BigInt(lastKnownEurcBalance);

        const usdcDiff = currentUsdc - prevUsdc;
        const eurcDiff = currentEurc - prevEurc;

        const notifications: string[] = [];

        if (usdcDiff > 0n) {
            const amount = (Number(usdcDiff) / 1_000_000).toFixed(2);
            const total = (Number(currentUsdc) / 1_000_000).toFixed(2);
            notifications.push(`💰 *Incoming payment received!*\n\n\\+${amount} USDC arrived in your wallet\\.\nNew balance: ${total} USDC`);
        }

        if (eurcDiff > 0n) {
            const amount = (Number(eurcDiff) / 1_000_000).toFixed(2);
            const total = (Number(currentEurc) / 1_000_000).toFixed(2);
            notifications.push(`💰 *Incoming payment received!*\n\n\\+${amount} EURC arrived in your wallet\\.\nNew balance: ${total} EURC`);
        }

        // Always update the stored balance to track the current state
        if (currentUsdc !== prevUsdc || currentEurc !== prevEurc) {
            this.watchStore.updateBalances(chatId, currentUsdc.toString(), currentEurc.toString());
        }

        for (const msg of notifications) {
            await this.bot.sendMessage(chatId, msg, { parse_mode: "MarkdownV2" });
        }
    }
}
