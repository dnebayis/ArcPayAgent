import dotenv from "dotenv";
import { ethers } from "ethers";
import { isRecoverableHealthServerError, startHealthServer } from "./http";
import { createBot } from "./telegram/bot";
import { setupHandlers } from "./telegram/handlers";
import { WalletStore } from "./storage/walletStore";
import { VendorStore } from "./storage/vendorStore";
import { USDC } from "./blockchain/usdc";
import { ArcRouter } from "./blockchain/arcRouter";
import { RouterReader } from "./blockchain/routerReader";
import { PaymentEngine } from "./engines/paymentEngine";
import { LLMKeyStore } from "./storage/llmKeyStore";
import { InvoiceStore } from "./storage/invoiceStore";
import { InvoiceEngine } from "./engines/invoiceEngine";
import { PaymentRequestStore } from "./storage/paymentRequests";
import { PaymentRequestEngine } from "./engines/paymentRequestEngine";
import { ConversationMemory } from "./agent/conversationMemory";
import { PaymentLogStore } from "./storage/paymentLogs";
import { AnalyticsEngine } from "./engines/analyticsEngine";
import { CircleClient } from "./blockchain/circleClient";
import { CircleAgentClient } from "./blockchain/circleAgentClient";
import { ScheduleStore } from "./storage/schedules";
import { PendingPaymentStore } from "./storage/pendingPayments";
import { SubmittedTransactionStore } from "./storage/submittedTransactions";
import { ARC_TESTNET_RPC_URL, getExpectedArcChainId } from "./blockchain/arcConfig";
import { SchedulerService } from "./services/scheduler";
import { WatchStore } from "./storage/watchStore";
import { AlertStore } from "./storage/alertStore";
import { WatchService } from "./services/watchService";
import { AlertService } from "./services/alertService";
import { flushPersistence, getPersistenceBackend, initializePersistence } from "./storage/persistence";
import { markBotReady, markPersistenceReady, markRpcReady, markRpcUnavailable, markSchedulerReady } from "./appStatus";
import { UserPreferencesStore } from "./storage/userPreferences";
import { loadRuntimeConfig } from "./config";
import { InternalToolset } from "./agent/internalTools";
import { AgentIdentityStore } from "./storage/agentIdentityStore";
import { ERC8004Client } from "./blockchain/erc8004Client";
import { AgentIdentityEngine } from "./engines/agentIdentityEngine";
import { Orchestrator } from "./core/orchestrator";
import { ToolDispatcher } from "./agent/toolDispatcher";
import { ResearchTools } from "./tools/researchTools";
import { RateLimiter } from "./middleware/rateLimiter";
import { AccessControl } from "./middleware/accessControl";
import { logger } from "./utils/logger";

dotenv.config();
process.env.NTBA_FIX_350 = process.env.NTBA_FIX_350 || "1";

let shutdownHandlersRegistered = false;

/** Populated in main() so the shutdown handler can check in-flight payments. */
let _paymentEngineRef: import("./engines/paymentEngine").PaymentEngine | null = null;

function registerShutdownHandlers(): void {
    if (shutdownHandlersRegistered || process.env.NODE_ENV === "test") {
        return;
    }

    const shutdown = async (signal: string) => {
        logger.info(null, `[App] ${signal} received — starting graceful shutdown`);
        try {
            // Run one final reconciliation pass and report in-flight count
            if (_paymentEngineRef) {
                const inFlight = _paymentEngineRef.getInFlightTransactionCount();
                if (inFlight > 0) {
                    logger.warn(null, `[App] ${inFlight} in-flight transaction(s) at shutdown — reconciling`);
                    await Promise.race([
                        _paymentEngineRef.reconcileSubmittedTransactions(),
                        new Promise(resolve => setTimeout(resolve, 10_000))
                    ]);
                    const remaining = _paymentEngineRef.getInFlightTransactionCount();
                    if (remaining > 0) {
                        logger.warn(null, `[App] ${remaining} transaction(s) still unresolved after reconcile — will retry on next boot`);
                    }
                }
            }
            await flushPersistence();
            logger.info(null, "[App] Persistence flushed. Exiting.");
        } catch (error: any) {
            logger.error(null, "[App] Error during shutdown", { error: error?.message });
        } finally {
            process.exit(0);
        }
    };

    process.once("SIGINT", () => { void shutdown("SIGINT"); });
    process.once("SIGTERM", () => { void shutdown("SIGTERM"); });

    shutdownHandlersRegistered = true;
}

export async function main() {
    console.log("Starting Arc Pay Agent...");
    const isTest = process.env.NODE_ENV === "test";
    const config = loadRuntimeConfig(process.env, { isTest });
    const webhookUrl = config.WEBHOOK_URL;
    const webhookSecret = config.WEBHOOK_SECRET;
    const shouldStartPolling = !isTest && !webhookUrl;
    const shouldStartScheduler = !isTest;
    const shouldStartHttp = !isTest && process.env.HEALTH_SERVER_ENABLED !== "false";
    const healthServerRequired = process.env.HEALTH_SERVER_REQUIRED === "true" || process.env.NODE_ENV === "production";
    const port = Number.parseInt(process.env.PORT || "3000", 10) || 3000;

    const token = config.TELEGRAM_TOKEN;
    const botUsername = config.BOT_USERNAME;

    const circleApiKey = config.CIRCLE_API_KEY;
    const circleEntitySecret = config.CIRCLE_ENTITY_SECRET;
    const circleWalletSetId = config.CIRCLE_WALLET_SET_ID;
    const circleApiUrl = config.CIRCLE_API_URL;

    const llmSecret = config.LLM_KEY_SECRET;

    const providerUrl = config.ARC_RPC_URL;
    const usdcAddress = config.USDC_ADDRESS;
    const eurcAddress = config.EURC_ADDRESS;
    const routerAddress = config.PAYABLES_ROUTER_ADDRESS;

    const provider = new ethers.JsonRpcProvider(providerUrl);
    let rpcAvailable = false;
    let rpcWarningLogged = false;

    const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms))
        ]);
    };

    const probeRpc = async (): Promise<boolean> => {
        try {
            const [, network] = await withTimeout(Promise.all([
                provider.getBlockNumber(),
                provider.getNetwork()
            ]), 5000);
            const expectedChainId = getExpectedArcChainId();
            if (network.chainId !== expectedChainId) {
                throw new Error(`RPC is connected to chain ${network.chainId.toString()} but expected Arc Testnet ${expectedChainId.toString()}`);
            }
            if (!rpcAvailable) {
                console.log("[RPC] Connectivity restored.");
            }
            rpcAvailable = true;
            rpcWarningLogged = false;
            markRpcReady();
            return true;
        } catch (error: any) {
            rpcAvailable = false;
            markRpcUnavailable();
            if (!rpcWarningLogged) {
                console.error(`[RPC] Connectivity check failed: ${error.message}`);
                rpcWarningLogged = true;
            }
            return false;
        }
    };

    await initializePersistence();
    markPersistenceReady();
    registerShutdownHandlers();
    console.log(`[Persistence] Using ${getPersistenceBackend()} backend`);
    await probeRpc();

    if (!token && !isTest) {
        console.error("[Bot] TELEGRAM_TOKEN is missing. Telegram polling is disabled.");
    }

    // ── Infrastructure ──────────────────────────────────────────────────────
    const bot = createBot(token || "mock-token", shouldStartPolling && !!token && !webhookUrl);

    // ── Webhook setup ────────────────────────────────────────────────────────
    let usingWebhook = false;
    if (webhookUrl && !isTest) {
        usingWebhook = true;
        const fullWebhookUrl = webhookUrl.endsWith("/telegram")
            ? webhookUrl
            : `${webhookUrl}/telegram`;
        try {
            await bot.setWebHook(fullWebhookUrl, {
                secret_token: webhookSecret || undefined,
                max_connections: 100,
            });
            console.log(`[Bot] Webhook registered: ${fullWebhookUrl}`);
        } catch (err: any) {
            console.error(`[Bot] Failed to set webhook: ${err.message}`);
        }
    }

    const circleClient = new CircleClient(circleApiKey, circleEntitySecret, circleWalletSetId, circleApiUrl);
    const walletStore = new WalletStore(circleClient);

    const vendorStore = new VendorStore();
    const llmKeyStore = new LLMKeyStore(llmSecret);
    const invoiceStore = new InvoiceStore();
    const paymentRequestStore = new PaymentRequestStore();
    const paymentLogStore = new PaymentLogStore();
    const userPreferencesStore = new UserPreferencesStore();
    const pendingPaymentStore = new PendingPaymentStore();
    const submittedTransactionStore = new SubmittedTransactionStore();
    const agentIdentityStore = new AgentIdentityStore();
    const circleAgentClient = new CircleAgentClient(
        config.CIRCLE_API_KEY,
        config.CIRCLE_ENTITY_SECRET,
        config.CIRCLE_API_URL
    );

    const usdc = new USDC(provider, usdcAddress);
    const eurc = new USDC(provider, eurcAddress);
    const router = new ArcRouter(provider, routerAddress);
    const routerReader = new RouterReader(provider, routerAddress);
    const erc8004Client = new ERC8004Client(provider, {
        identityRegistry: config.ERC8004_IDENTITY_REGISTRY_ADDRESS,
        reputationRegistry: config.ERC8004_REPUTATION_REGISTRY_ADDRESS,
        validationRegistry: config.ERC8004_VALIDATION_REGISTRY_ADDRESS
    });

    const conversationMemory = new ConversationMemory();
    const scheduleStore = new ScheduleStore();
    const watchStore = new WatchStore();
    const alertStore = new AlertStore();

    // ── Memory callback — syncs engine messages to conversation history ───
    const onEngineMessage = (chatId: number, msg: string) => conversationMemory.addBotMessage(chatId, msg);

    // ── Engines ─────────────────────────────────────────────────────────────
    const invoiceEngine = new InvoiceEngine(bot, invoiceStore, vendorStore, conversationMemory, onEngineMessage);
    const paymentRequestEngine = new PaymentRequestEngine(bot, paymentRequestStore, walletStore, botUsername, onEngineMessage);
    const analyticsEngine = new AnalyticsEngine(bot, paymentLogStore, onEngineMessage);
    const schedulerService = new SchedulerService(bot, scheduleStore, null as any, userPreferencesStore);
    const watchService = new WatchService(bot, watchStore, usdc, eurc);

    const agentIdentityEngine = new AgentIdentityEngine(circleAgentClient, erc8004Client, agentIdentityStore, {
        metadataUri: config.ARC_AGENT_METADATA_URI,
        ownerWalletId: config.ARC_AGENT_OWNER_WALLET_ID,
        validatorWalletId: config.ARC_AGENT_VALIDATOR_WALLET_ID,
        agentId: config.ARC_AGENT_ID,
        walletSetName: config.ARC_AGENT_WALLET_SET_NAME
    });

    // Auto-reconcile agent identity at startup (non-blocking)
    // Runs when the store has no agentId but env vars are set, e.g. after a redeploy that wiped SQLite
    if (!agentIdentityStore.get().agentId && (config.ARC_AGENT_OWNER_WALLET_ID || config.ARC_AGENT_ID)) {
        console.log("[AgentIdentity] Store is empty — auto-reconciling from chain...");
        agentIdentityEngine.recoverRegistration()
            .then((result) => console.log(`[AgentIdentity] Auto-reconcile complete. Agent ID: ${result.agentId}`))
            .catch((error: Error) => console.warn("[AgentIdentity] Auto-reconcile failed:", error.message));
    }

    const paymentEngine = new PaymentEngine(
        bot,
        usdc,
        router,
        routerAddress,
        walletStore,
        vendorStore,
        provider,
        paymentLogStore,
        circleClient,
        pendingPaymentStore,
        submittedTransactionStore,
        (chatId, payment) => {
            const source = payment.source;
            if (!source) return;

            if (source.type === "request" && source.requestId) {
                paymentRequestEngine.markPaid(source.requestId);
                if (source.originChatId && source.originMessageId) {
                    bot.editMessageText("✅ Payment request completed.", {
                        chat_id: source.originChatId,
                        message_id: source.originMessageId
                    }).catch((err: any) => logger.warn(null, "[Bot] editMessageText failed", { error: err?.message }));
                }
                return;
            }

            if (source.type === "schedule" && source.scheduleId) {
                scheduleStore.markExecuted(chatId, source.scheduleId);
                if (source.originChatId && source.originMessageId) {
                    const schedPayToken = payment.token ?? "USDC";
                    bot.editMessageText(`✅ Scheduled payment completed: ${payment.amountStr} ${schedPayToken} → ${payment.vendorName || payment.beneficiary}`, {
                        chat_id: source.originChatId,
                        message_id: source.originMessageId
                    }).catch((err: any) => logger.warn(null, "[Bot] editMessageText failed", { error: err?.message }));
                }
                return;
            }

            if (source.type === "invoice") {
                invoiceEngine.markSessionPaid(chatId, source.invoiceSessionId);
                if (source.originChatId && source.originMessageId) {
                    const invPayToken = payment.token ?? "USDC";
                    bot.editMessageText(`✅ Invoice payment completed: ${payment.amountStr} ${invPayToken} → ${payment.vendorName || payment.beneficiary}`, {
                        chat_id: source.originChatId,
                        message_id: source.originMessageId
                    }).catch((err: any) => logger.warn(null, "[Bot] editMessageText failed", { error: err?.message }));
                }
            }
        },
        (chatId, payment, reason) => {
            // Clear transient action/payment/invoice context so the orchestrator's
            // pending-payment guards stop firing after the payment resolves.
            conversationMemory.clearTemporaryContext(chatId);

            const source = payment.source;
            if (!source || source.type !== "invoice") return;
            if (reason === "cancelled" || reason === "failed") {
                invoiceEngine.restoreSessionAfterPaymentInterruption(chatId, source.invoiceSessionId);
            }
        },
        onEngineMessage,
        eurc,
        eurcAddress
    );

    // Fix scheduler with payment engine reference
    (schedulerService as any).paymentEngine = paymentEngine;
    _paymentEngineRef = paymentEngine;

    // ── Internal toolset ─────────────────────────────────────────────────────
    const internalToolset = new InternalToolset({
        walletStore,
        vendorStore,
        analyticsEngine,
        paymentLogs: paymentLogStore,
        scheduleStore,
        invoiceEngine,
        conversationMemory,
        usdc,
        eurc,
        agentIdentityEngine,
        pendingPaymentStore
    });

    // ── New AI architecture ──────────────────────────────────────────────────
    const researchTools = new ResearchTools(provider, routerReader, routerAddress);
    const alertService = new AlertService(bot, alertStore, researchTools);

    const toolDispatcher = new ToolDispatcher({
        bot,
        paymentEngine,
        analyticsEngine,
        paymentRequestEngine,
        vendorStore,
        walletStore,
        scheduleStore,
        userPreferencesStore,
        watchStore,
        alertStore,
        internalTools: internalToolset,
        memory: conversationMemory,
        usdc,
        eurc
    });

    const orchestrator = new Orchestrator(
        bot,
        llmKeyStore,
        conversationMemory,
        walletStore,
        researchTools,
        (chatId, intent) => toolDispatcher.execute(chatId, intent),
        config.USE_TOOL_CALLING
    );

    // ── Telegram handlers ────────────────────────────────────────────────────
    const rateLimiter = new RateLimiter();
    const accessControl = new AccessControl(config.ALLOWED_CHAT_IDS);
    // Prune stale rate-limit windows every 5 minutes
    setInterval(() => rateLimiter.prune(), 5 * 60 * 1000);

    setupHandlers(
        bot,
        walletStore,
        llmKeyStore,
        orchestrator,
        paymentEngine,
        invoiceEngine,
        paymentRequestEngine,
        conversationMemory,
        scheduleStore,
        userPreferencesStore,
        accessControl,
        rateLimiter
    );
    markBotReady();

    // ── Background tasks ─────────────────────────────────────────────────────
    if (shouldStartScheduler) {
        setInterval(() => { void probeRpc(); }, 30000);
        setInterval(() => { void paymentEngine.reconcileSubmittedTransactions(); }, 5000);
        setInterval(() => { paymentEngine.expireOldPendingPayments(); }, 60 * 1000);
        schedulerService.start();
        watchService.start();
        alertService.start();
        markSchedulerReady();
    }

    console.log("Bot initialized!");

    let server: import("http").Server | null = null;
    if (shouldStartHttp) {
        try {
            server = await startHealthServer(port);
            console.log(`[HTTP] Health server listening on port ${port}`);
            if (usingWebhook && server) {
                const { addTelegramWebhookHandler } = await import("./http");
                addTelegramWebhookHandler(server, bot, webhookSecret || undefined);
                console.log(`[Bot] Webhook handler active at /telegram`);
            }
        } catch (error) {
            if (isRecoverableHealthServerError(error, { required: healthServerRequired })) {
                console.warn(`[HTTP] Port ${port} is already in use. Continuing without a local health server.`);
            } else {
                console.error("[HTTP] Failed to start health server:", error);
                throw error;
            }
        }
    }
}

if (process.env.NODE_ENV !== "test") {
    void main().catch((error) => {
        console.error("[App] Failed to initialize Arc Pay Agent:", error);
        process.exit(1);
    });
}
