import { loadConfig, getConfig } from "./config";
import { logger } from "./utils/logger";
import { ethers } from "ethers";

// Chain
import { CircleClient } from "./chain/circle";
import { TokenOps } from "./chain/tokens";
import { ArcRouter } from "./chain/router";
import { ERC8004Client } from "./chain/erc8004";

// Store
import { Store } from "./store/base";
import { WalletStore } from "./store/wallets";
import { VendorStore } from "./store/vendors";
import { PendingPaymentStore } from "./store/pending";
import { SubmittedTxStore } from "./store/submitted";
import { PaymentLogStore } from "./store/payments";
import { ScheduleStore } from "./store/schedules";
import { AlertStore } from "./store/alerts";
import { WatchStore } from "./store/watch";
import { InvoiceStore } from "./store/invoices";
import { PaymentRequestStore } from "./store/requests";
import { LLMKeyStore } from "./store/keys";
import { AgentIdentityStore } from "./store/identity";

// Memory
import { ConversationMemory } from "./memory/conversation";

// Core
import { Sender } from "./core/sender";
import { FlowStateManager } from "./core/state";
import { Orchestrator } from "./core/orchestrator";

// Engines
import { PaymentEngine } from "./engines/payment";
import { InvoiceEngine } from "./engines/invoice";
import { AnalyticsEngine } from "./engines/analytics";
import { RequestEngine } from "./engines/requests";
import { IdentityEngine } from "./engines/identity";

// Actions
import { registerPaymentActions } from "./actions/payment";
import { registerVendorActions } from "./actions/vendor";
import { registerWalletActions } from "./actions/wallet";
import { registerAnalyticsActions } from "./actions/analytics";
import { registerAlertActions } from "./actions/alerts";
import { registerResearchActions } from "./actions/research";
import { registerAgentActions } from "./actions/agent";

// Services
import { SchedulerService } from "./services/scheduler";
import { WatcherService } from "./services/watcher";
import { AlerterService } from "./services/alerter";

// Telegram
import { attachHandlers } from "./telegram/bot";

// Health
import { startHealthServer } from "./health";

async function main(): Promise<void> {
    // ─── Config ───
    const config = loadConfig();
    logger.info(null, "ArcPay Agent starting...");

    // ─── Provider ───
    const provider = new ethers.JsonRpcProvider(config.ARC_RPC_URL, config.ARC_CHAIN_ID);

    // ─── Chain layer ───
    const circle = new CircleClient(config.CIRCLE_API_KEY, config.CIRCLE_ENTITY_SECRET, config.CIRCLE_WALLET_SET_ID, config.CIRCLE_API_URL);
    const tokens = new TokenOps(provider, config.USDC_ADDRESS, config.EURC_ADDRESS);
    const router = new ArcRouter(config.PAYABLES_ROUTER_ADDRESS);
    const erc8004 = new ERC8004Client(provider, config.ERC8004_IDENTITY_REGISTRY, config.ERC8004_REPUTATION_REGISTRY, config.ERC8004_VALIDATION_REGISTRY);

    // ─── Store layer ───
    const store = new Store("data");
    await store.init();
    const wallets = new WalletStore(store);
    const vendors = new VendorStore(store);
    const pending = new PendingPaymentStore(store);
    const submitted = new SubmittedTxStore(store);
    const paymentLog = new PaymentLogStore(store);
    const schedules = new ScheduleStore(store);
    const alerts = new AlertStore(store);
    const watch = new WatchStore(store);
    const invoices = new InvoiceStore(store);
    const requests = new PaymentRequestStore(store);
    const keys = new LLMKeyStore(store, config.LLM_KEY_SECRET);
    const identityStore = new AgentIdentityStore(store);

    // ─── Memory ───
    const memory = new ConversationMemory();

    // ─── Bot instance ───
    const TelegramBot = (await import("node-telegram-bot-api")).default;
    const bot = config.WEBHOOK_URL
        ? new TelegramBot(config.TELEGRAM_TOKEN, { webHook: true })
        : new TelegramBot(config.TELEGRAM_TOKEN, { polling: true });

    // ─── Sender ───
    const sender = new Sender(bot, memory);
    const send = (chatId: number, text: string) => sender.send(chatId, text).then(() => {});
    const sendCard = (chatId: number, text: string, keyboard: any[][]) => sender.sendCard(chatId, text, keyboard).then(() => {});

    // ─── Engines ───
    const paymentEngine = new PaymentEngine({
        circle, tokens, router, wallets, vendors, pending, submitted, paymentLog, memory, sendCard, send,
    });
    const invoiceEngine = new InvoiceEngine({
        invoices, vendors, memory, send, sendCard,
        getLLMAuth: (chatId: number) => keys.getAuth(chatId),
    });
    const analyticsEngine = new AnalyticsEngine({
        paymentLog, vendors, schedules, wallets, tokens, send,
    });
    const requestEngine = new RequestEngine({
        requests, wallets, send, sendCard,
    });
    const identityEngine = new IdentityEngine({
        circle, erc8004, identityStore, wallets, send,
    });

    // ─── Flow state + Orchestrator ───
    const flowState = new FlowStateManager(memory);
    const orchestrator = new Orchestrator(memory, flowState, sender, keys);

    // ─── Register actions ───
    registerPaymentActions({ paymentEngine, schedules, vendors, wallets, memory, send });
    registerVendorActions({ vendors, memory, send });
    registerWalletActions({ circle, tokens, wallets, paymentLog, memory, send });
    registerAnalyticsActions({ analyticsEngine });
    registerAlertActions({ alerts, watch, wallets, send });
    registerResearchActions({ wallets, provider, send });
    registerAgentActions({ identityEngine, requestEngine, invoiceEngine, send });

    // ─── Attach Telegram handlers ───
    attachHandlers(bot, {
        orchestrator, sender, paymentEngine, invoiceEngine, requestEngine,
        requests, keys, memory,
    });

    // ─── Services ───
    const scheduler = new SchedulerService(schedules, paymentEngine, sender, config.SCHEDULER_INTERVAL_MS);
    const watcher = new WatcherService(watch, tokens, sender, config.WATCHER_INTERVAL_MS);
    const alerter = new AlerterService(alerts, sender, config.ALERTER_INTERVAL_MS);

    // ─── Startup ───
    await paymentEngine.reconcile();
    await identityEngine.initialize();

    scheduler.start();
    watcher.start();
    alerter.start();

    // ─── Health ───
    startHealthServer(config.PORT);

    logger.info(null, "ArcPay Agent ready", {
        mode: config.WEBHOOK_URL ? "webhook" : "polling",
    });

    // ─── Graceful shutdown ───
    const shutdown = () => {
        logger.info(null, "Shutting down...");
        scheduler.stop();
        watcher.stop();
        alerter.stop();
        bot.stopPolling?.();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

main().catch(err => {
    logger.error(null, "Fatal startup error", { error: err.message, stack: err.stack });
    process.exit(1);
});
