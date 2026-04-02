import { registerAction } from "./registry";
import type { AlertStore } from "../store/alerts";
import type { WatchStore } from "../store/watch";
import type { WalletStore } from "../store/wallets";

export interface AlertActionDeps {
    alerts: AlertStore;
    watch: WatchStore;
    wallets: WalletStore;
    send: (chatId: number, text: string) => Promise<void>;
}

export function registerAlertActions(deps: AlertActionDeps): void {
    registerAction("set_price_alert", async (chatId, params) => {
        const { symbol, target_price, direction } = params;
        if (!symbol || !target_price || !direction) {
            await deps.send(chatId, "Please provide symbol, target price, and direction (above/below).");
            return;
        }

        const alert = await deps.alerts.createAlert(chatId, {
            symbol: symbol.toUpperCase(),
            targetPrice: Number(target_price),
            direction,
        });

        if (!alert) {
            await deps.send(chatId, `You already have an alert for ${symbol.toUpperCase()} ${direction} $${Number(target_price).toLocaleString()}.`);
            return;
        }

        await deps.send(chatId, `Price alert set: ${symbol.toUpperCase()} ${direction} $${Number(target_price).toLocaleString()}`);
    });

    registerAction("list_price_alerts", async (chatId) => {
        const alerts = await deps.alerts.getAlerts(chatId);
        if (alerts.length === 0) {
            await deps.send(chatId, "No active price alerts.");
            return;
        }

        let text = "Price Alerts\n\n";
        for (const a of alerts) {
            text += `${a.id}: ${a.symbol} ${a.direction} $${a.targetPrice.toLocaleString()}\n`;
        }
        await deps.send(chatId, text);
    });

    registerAction("remove_price_alert", async (chatId, params) => {
        const { alert_id } = params;
        if (!alert_id) {
            await deps.send(chatId, "Please provide the alert ID to remove.");
            return;
        }
        const removed = await deps.alerts.removeAlert(chatId, alert_id);
        await deps.send(chatId, removed
            ? `Alert ${alert_id} removed.`
            : `Alert ${alert_id} not found.`);
    });

    registerAction("remove_all_price_alerts", async (chatId) => {
        const count = await deps.alerts.removeAllAlerts(chatId);
        await deps.send(chatId, count > 0
            ? `Removed ${count} alert(s).`
            : "No alerts to remove.");
    });

    registerAction("watch_payments_enable", async (chatId) => {
        const address = await deps.wallets.getWalletAddress(chatId);
        if (!address) {
            await deps.send(chatId, "You need a wallet first.");
            return;
        }
        await deps.watch.enable(chatId, address);
        await deps.send(chatId, "Incoming payment notifications enabled.");
    });

    registerAction("watch_payments_disable", async (chatId) => {
        await deps.watch.disable(chatId);
        await deps.send(chatId, "Payment notifications disabled.");
    });

    registerAction("watch_payments_status", async (chatId) => {
        const enabled = await deps.watch.isEnabled(chatId);
        await deps.send(chatId, enabled
            ? "Payment notifications are enabled."
            : "Payment notifications are disabled.");
    });
}
