import dotenv from "dotenv";
import { ethers } from "ethers";
import { startHealthServer } from "./http";
import { createBot } from "./telegram/bot";
import { setupHandlers } from "./telegram/handlers";
import { WalletStore } from "./storage/walletStore";
import { VendorStore } from "./storage/vendorStore";
import { USDC } from "./blockchain/usdc";
import { ArcRouter } from "./blockchain/arcRouter";
import { RouterReader, RouterPaymentEvent } from "./blockchain/routerReader";
import { PaymentEngine } from "./engines/paymentEngine";
import { IntentParser } from "./ai/intentParser";
import { LLMKeyStore } from "./storage/llmKeyStore";
import { InvoiceStore } from "./storage/invoiceStore";
import { InvoiceEngine } from "./engines/invoiceEngine";
import { PaymentRequestStore } from "./storage/paymentRequests";
import { PaymentRequestEngine } from "./engines/paymentRequestEngine";
import { ToolRegistry } from "./agent/toolRegistry";
import { ToolRouter } from "./agent/toolRouter";
import { ConversationMemory } from "./agent/conversationMemory";
import { SessionStore } from "./agent/sessionStore";
import { PaymentLogStore } from "./storage/paymentLogs";
import { AnalyticsEngine } from "./engines/analyticsEngine";
import { CircleClient } from "./blockchain/circleClient";
import { ScheduleStore } from "./storage/schedules";
import { SchedulerService } from "./services/scheduler";
import { parseScheduleDate, formatScheduleTime } from "./utils/dateParser";
import { MemoryStore } from "./ai/memoryStore";
import { flushPersistence, getPersistenceBackend, initializePersistence } from "./storage/persistence";
import { markBotReady, markPersistenceReady, markSchedulerReady } from "./appStatus";
import { UserPreferencesStore } from "./storage/userPreferences";
import { formatUserDateTime } from "./utils/userDateTime";

dotenv.config();
process.env.NTBA_FIX_350 = process.env.NTBA_FIX_350 || "1";

let shutdownHandlersRegistered = false;

function registerShutdownHandlers(): void {
    if (shutdownHandlersRegistered || process.env.NODE_ENV === "test") {
        return;
    }

    const shutdown = async (signal: string) => {
        try {
            console.log(`[App] ${signal} received. Flushing persistence...`);
            await flushPersistence();
        } catch (error) {
            console.error("[App] Failed to flush persistence during shutdown:", error);
        } finally {
            process.exit(0);
        }
    };

    process.once("SIGINT", () => {
        void shutdown("SIGINT");
    });

    process.once("SIGTERM", () => {
        void shutdown("SIGTERM");
    });

    shutdownHandlersRegistered = true;
}

export async function main() {
    console.log("Starting ArcPay Agent...");
    const isTest = process.env.NODE_ENV === "test";
    const shouldStartPolling = !isTest;
    const shouldStartScheduler = !isTest;
    const shouldStartHttp = !isTest;
    const port = Number.parseInt(process.env.PORT || "3000", 10) || 3000;

    const token = process.env.TELEGRAM_TOKEN;
    const botUsername = process.env.BOT_USERNAME || "ArcPayAgentBot";

    const circleApiKey = process.env.CIRCLE_API_KEY || "";
    const circleEntitySecret = process.env.CIRCLE_ENTITY_SECRET || "";
    const circleWalletSetId = process.env.CIRCLE_WALLET_SET_ID || "";
    const circleApiUrl = process.env.CIRCLE_API_URL || "https://api.circle.com/v1/w3s";

    const llmSecret = process.env.LLM_KEY_SECRET || "";

    if (!isTest && !llmSecret) {
        throw new Error("Missing LLM_KEY_SECRET. Refusing to start with an unsafe fallback secret.");
    }

    const providerUrl = process.env.ARC_RPC_URL || "https://testnet.arcscan.app/rpc";
    const usdcAddress = process.env.USDC_ADDRESS || "0x0000000000000000000000000000000000000000";
    const routerAddress = process.env.PAYABLES_ROUTER_ADDRESS || "0x0000000000000000000000000000000000000000";

    const provider = new ethers.JsonRpcProvider(providerUrl);

    const paymentHistorySource = (process.env.PAYMENT_HISTORY_SOURCE || "local").toLowerCase();
    const configuredChunkSize = Number.parseInt(process.env.PAYMENT_HISTORY_CHUNK || "", 10);
    const paymentHistoryChunkSize = Number.isInteger(configuredChunkSize) && configuredChunkSize > 0
        ? Math.min(10000, configuredChunkSize)
        : 8000;
    const configuredWindowCount = Number.parseInt(process.env.PAYMENT_HISTORY_WINDOWS || "", 10);
    const paymentHistoryWindows = Number.isInteger(configuredWindowCount) && configuredWindowCount > 0
        ? Math.min(6, configuredWindowCount)
        : 2;
    const maxScanBlocks = paymentHistoryChunkSize * paymentHistoryWindows;

    await initializePersistence();
    markPersistenceReady();
    registerShutdownHandlers();
    console.log(`[Persistence] Using ${getPersistenceBackend()} backend`);

    const formatRouterAddress = (address: string): string => {
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    };

    const formatDateForHistory = (timestampMs: number): string => {
        const d = new Date(timestampMs);
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        const hour = String(d.getHours()).padStart(2, "0");
        const minute = String(d.getMinutes()).padStart(2, "0");
        return `${month}/${day} ${hour}:${minute}`;
    };

    const formatRouterAmount = (amount: bigint): string => {
        try {
            return ethers.formatUnits(amount, 6);
        } catch {
            return amount.toString();
        }
    };

    const collectRecentRouterEvents = async (walletAddress: string): Promise<RouterPaymentEvent[]> => {
        const latestBlock = await provider.getBlockNumber();
        const startBlock = Math.max(0, latestBlock - maxScanBlocks + 1);
        const allEvents: RouterPaymentEvent[] = [];

        for (let fromBlock = startBlock; fromBlock <= latestBlock; fromBlock += paymentHistoryChunkSize) {
            const toBlock = Math.min(fromBlock + paymentHistoryChunkSize - 1, latestBlock);
            const chunkEvents = await routerReader.getRouterEvents(walletAddress, fromBlock, toBlock);
            allEvents.push(...chunkEvents);
        }

        const uniqMap = new Map<string, RouterPaymentEvent>();
        for (const event of allEvents) {
            const key = `${event.transactionHash}-${event.sender}-${event.recipient}-${event.amount.toString()}-${event.timestamp}`;
            uniqMap.set(key, event);
        }

        return Array.from(uniqMap.values()).sort((a, b) => b.timestamp - a.timestamp);
    };

    const showRouterPayments = async (chatId: number, isPending: boolean): Promise<void> => {
        const walletAddress = walletStore.getWalletAddress(chatId);

        if (!walletAddress) {
            bot.sendMessage(chatId, "You don't have a wallet yet. Try `create wallet` to get started.", { parse_mode: "Markdown" });
            return;
        }

        if (paymentHistorySource !== "router") {
            if (isPending) {
                bot.sendMessage(chatId, "On-chain pending status is not exposed on this router. Use `payment history` to review executed payments.", { parse_mode: "Markdown" });
            } else {
                bot.sendMessage(
                    chatId,
                    "⚠️ On-chain recent payments are unavailable right now because router activity is disabled. Use `payment history` for your recorded payment log."
                );
            }
            return;
        }

        try {
            const events = await collectRecentRouterEvents(walletAddress.toLowerCase());
            const normalizedWallet = walletAddress.toLowerCase();
            const relevantEvents = events; // pending path intentionally shares the same source for safety

            if (relevantEvents.length === 0) {
                if (isPending) {
                    bot.sendMessage(chatId, "✅ No pending router payments. Router executes instantly after confirm.");
                } else {
                    bot.sendMessage(chatId, "📜 No recent router payments found yet. Once you send a payment, activity will appear here.");
                }
                return;
            }

            const rows = relevantEvents
                .slice(0, 10)
                .map((event) => {
                    const isOut = event.sender.toLowerCase() === normalizedWallet;
                    const peer = isOut ? event.recipient : event.sender;
                    const sign = isOut ? "↓" : "↑";
                    const action = isOut ? "Sent to" : "Received from";
                    const memo = event.memo ? ` · ${event.memo}` : "";
                    return `${formatDateForHistory(event.timestamp)} ${sign} ${action} ${formatRouterAmount(event.amount)} USDC → \`${formatRouterAddress(peer)}\`${memo}`;
                });

            if (isPending) {
                bot.sendMessage(
                    chatId,
                    `⏳ **Router Pending Payments**

⚠️ Arc Router does not keep persistent pending transactions.
Recent related activity (informational):
${rows.join("\n")}`,
                    { parse_mode: "Markdown" }
                );
                return;
            }

            bot.sendMessage(
                chatId,
                `📜 **Recent Router Payments** (last ${rows.length})

${rows.join("\n")}`,
                { parse_mode: "Markdown" }
            );
        } catch (error) {
            console.error("[Payment History] failed to fetch router payments:", error);
            bot.sendMessage(chatId, "⚠️ I couldn't load router payment history right now. Try `payment history` instead.");
        }
    };

    const buildAccountSummaryMessage = async (chatId: number): Promise<string> => {
        const address = walletStore.getWalletAddress(chatId);
        const vendors = vendorStore.getVendorsWithStats(chatId) || {};
        const vendorCount = Object.keys(vendors).length;
        const activeSchedules = scheduleStore.getSchedules(chatId).length;
        const recentPayments = paymentLogStore.getRecentPayments(chatId, 3);
        const recordedPayments = paymentLogStore.getPayments(chatId).length;
        const spent30d = analyticsEngine.getTotalSpending(chatId, Date.now() - 30 * 24 * 60 * 60 * 1000);
        const topVendor = analyticsEngine.getSpendingByVendor(chatId, Date.now() - 30 * 24 * 60 * 60 * 1000)[0];

        if (!address) {
            return "🏦 **Account Summary**\n\nWallet: Not set up\nSaved vendors: **0**\nActive schedules: **0**\nRecorded payments: **0**\n\nNext: create your wallet with `create wallet`.";
        }

        const rawUsdcBalance = await usdc.balanceOf(address).catch(() => 0n);
        const balance = ethers.formatUnits(rawUsdcBalance, 6);
        const lastPayment = recentPayments[recentPayments.length - 1];
        const lastPaymentLine = lastPayment
            ? `Last payment: **${lastPayment.amount} USDC** → ${lastPayment.vendor || `${lastPayment.address.slice(0, 8)}...`}`
            : "Last payment: None yet";
        const topVendorLine = topVendor
            ? `Top vendor (30d): **${topVendor.vendor}** — ${topVendor.total} USDC`
            : "Top vendor (30d): None yet";

        const readinessLine = vendorCount > 0
            ? "Account state: **Ready to send and schedule payments**"
            : "Account state: **Wallet ready — add a vendor to speed up payments**";

        return `🏦 **Account Summary**\n\nAddress: \`${address}\`\nAvailable balance: **${balance} USDC**\nSpent in the last 30 days: **${spent30d} USDC**\nRecorded payments: **${recordedPayments}**\nSaved vendors: **${vendorCount}**\nActive schedules: **${activeSchedules}**\n${readinessLine}\n${topVendorLine}\n${lastPaymentLine}\n\nTry \`wallet balance\`, \`payment history\`, or \`list schedules\`.`;
    };

    if (!token && !isTest) {
        console.error("[Bot] TELEGRAM_TOKEN is missing. Telegram polling is disabled.");
    }

    const bot = createBot(token || "mock-token", shouldStartPolling && !!token);

    const circleClient = new CircleClient(circleApiKey, circleEntitySecret, circleWalletSetId, circleApiUrl);
    const walletStore = new WalletStore(circleClient);

    const vendorStore = new VendorStore();
    const llmKeyStore = new LLMKeyStore(llmSecret);
    const invoiceStore = new InvoiceStore();
    const paymentRequestStore = new PaymentRequestStore();
    const paymentLogStore = new PaymentLogStore();
    const userPreferencesStore = new UserPreferencesStore();

    const usdc = new USDC(provider, usdcAddress);
    const router = new ArcRouter(provider, routerAddress);
    const routerReader = new RouterReader(provider, routerAddress);

    const conversationMemory = new ConversationMemory();
    const sessionStore = new SessionStore();
    const memoryStore = new MemoryStore();

    const paymentEngine = new PaymentEngine(bot, usdc, router, routerAddress, walletStore, vendorStore, provider, paymentLogStore, circleClient, sessionStore, memoryStore);
    const intentParser = new IntentParser(llmKeyStore, conversationMemory, sessionStore, memoryStore);
    const invoiceEngine = new InvoiceEngine(bot, invoiceStore, vendorStore, memoryStore);
    const paymentRequestEngine = new PaymentRequestEngine(bot, paymentRequestStore, walletStore, botUsername);
    const analyticsEngine = new AnalyticsEngine(bot, paymentLogStore);
    const scheduleStore = new ScheduleStore();
    const schedulerService = new SchedulerService(bot, scheduleStore, paymentEngine, userPreferencesStore);

    // ── Register tools ──
    const registry = new ToolRegistry();

    registry.register("create_payment", "Send USDC to a recipient", (chatId, intent) => {
        if (intent.amount && intent.beneficiary) {
            paymentEngine.preparePayment(chatId, intent.beneficiary, intent.amount.toString());
        } else {
            bot.sendMessage(chatId, "Please specify an amount and recipient. Example: `send 5 usdc to jack`", { parse_mode: "Markdown" });
        }
    });

    registry.register("save_vendor", "Save a vendor address", (chatId, intent) => {
        if (intent.name && intent.address) {
            vendorStore.saveVendor(chatId, intent.name, intent.address);
            memoryStore.recordVendorAdded(chatId, intent.name);
            bot.sendMessage(chatId, `✅ Vendor saved!\n\nName: ${intent.name}\nAddress: \`${intent.address}\``, { parse_mode: "Markdown" });
        } else {
            bot.sendMessage(chatId, "Please specify a vendor name and address. Example: `save vendor jack 0xabc...`", { parse_mode: "Markdown" });
        }
    });

    // cancel_payment / update_payment
    registry.register("cancel_payment", "Cancel pending payment", (chatId) => {
        paymentEngine.cancelPendingPayment(chatId);
    });

    registry.register("update_payment_vendor", "Update pending payment vendor", (chatId, intent) => {
        if (intent.beneficiary) {
            paymentEngine.updatePendingPayment(chatId, { vendor: intent.beneficiary });
        }
    });

    registry.register("update_payment_amount", "Update pending payment amount", (chatId, intent) => {
        if (intent.amount) {
            paymentEngine.updatePendingPayment(chatId, { amount: intent.amount });
        }
    });

    registry.register("update_payment_memo", "Update pending payment memo", (chatId, intent) => {
        if (intent.message) {
            paymentEngine.updatePendingPayment(chatId, { memo: intent.message });
        }
    });

    registry.register("list_vendors", "List saved vendors", (chatId) => {
        const vendors = vendorStore.getVendorsWithStats(chatId);
        if (!vendors || Object.keys(vendors).length === 0) {
            bot.sendMessage(chatId, "No vendors saved yet. Try `save vendor jack 0x...` to add your first one.", { parse_mode: "Markdown" });
            return;
        }
        let msg = "📋 **Your Vendors**\n\n";
        for (const [name, data] of Object.entries(vendors)) {
            const shortAddr = `${data.address.slice(0, 6)}...${data.address.slice(-4)}`;
            const paid = data.totalPaid > 0 ? ` • ${data.totalPaid} USDC paid` : "";
            msg += `• **${name}** → \`${shortAddr}\`${paid}\n`;
        }
        bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
    });

    registry.register("vendor_detail", "Show vendor details", (chatId, intent) => {
        if (!intent.name) {
            bot.sendMessage(chatId, "Please specify a vendor name. Example: vendor aws");
            return;
        }
        const data = vendorStore.getVendorData(chatId, intent.name);
        if (!data) {
            bot.sendMessage(chatId, `❌ Vendor "${intent.name}" not found.`);
            return;
        }

        const timeAgo = (ts: number | null) => {
            if (!ts) return "Never";
            const diff = Date.now() - ts;
            const mins = Math.floor(diff / 60000);
            if (mins < 60) return `${mins}m ago`;
            const hours = Math.floor(mins / 60);
            if (hours < 24) return `${hours}h ago`;
            const days = Math.floor(hours / 24);
            return `${days}d ago`;
        };

        let msg = `📊 **Vendor: ${intent.name}**\n\n`;
        msg += `Address: \`${data.address}\`\n`;
        msg += `Total paid: **${data.totalPaid} USDC**\n`;
        msg += `Payments: **${data.invoiceCount}**\n`;
        msg += `Last payment: ${timeAgo(data.lastPayment)}\n`;
        if (data.lastInvoice) msg += `Last invoice: ${timeAgo(data.lastInvoice)}\n`;

        bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
    });

    registry.register("top_vendors", "Show top vendors by spending", (chatId) => {
        const top = vendorStore.getTopVendors(chatId);
        if (top.length === 0) {
            bot.sendMessage(chatId, "No vendor payment data yet. Send a payment first, then ask for `top vendors`.", { parse_mode: "Markdown" });
            return;
        }

        let msg = "🏆 **Top Vendors**\n\n";
        top.forEach((v, i) => {
            const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
            msg += `${medal} **${v.name}** → ${v.data.totalPaid} USDC (${v.data.invoiceCount} payments)\n`;
        });

        bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
    });

    registry.register("remove_vendor", "Remove a vendor", (chatId, intent) => {
        if (intent.name) {
            const removed = vendorStore.removeVendor(chatId, intent.name);
            if (removed) {
                bot.sendMessage(chatId, `✅ Vendor **${intent.name}** removed.`, { parse_mode: "Markdown" });
            } else {
                bot.sendMessage(chatId, `❌ Vendor "${intent.name}" not found.`);
            }
        } else {
            bot.sendMessage(chatId, "Please specify which vendor to remove. Example: remove vendor jack");
        }
    });

    registry.register("remove_all_vendors", "Remove all vendors", (chatId) => {
        const count = vendorStore.removeAllVendors(chatId);
        if (count > 0) {
            bot.sendMessage(chatId, `✅ All ${count} vendor(s) removed.`);
        } else {
            bot.sendMessage(chatId, "No vendors to remove.");
        }
    });

    registry.register("create_payment_request", "Create a payment request link", (chatId, intent) => {
        if (intent.amount) {
            paymentRequestEngine.createRequest(chatId, intent.amount);
        } else {
            bot.sendMessage(chatId, "Please specify an amount. Example: request 10 usdc");
        }
    });

    registry.register("analyze_invoice", "Analyze an invoice", (chatId) => {
        bot.sendMessage(chatId, "📄 Please send me an invoice as a PDF document or photo, and I'll extract the payment details.");
    });

    registry.register("report", "Show spending report", (chatId) => {
        analyticsEngine.showReport(chatId, "month");
    });

    registry.register("spending_by_vendor", "Show spending breakdown by vendor", (chatId) => {
        analyticsEngine.showReport(chatId, "all");
    });

    registry.register("payment_history", "Show recent payments", (chatId) => {
        analyticsEngine.showHistory(chatId);
    });

    registry.register("show_pending_payments", "Show pending router payments", (chatId) => {
        showRouterPayments(chatId, true);
    });

    registry.register("show_recent_payments", "Show recent router payments", (chatId) => {
        showRouterPayments(chatId, false);
    });

    registry.register("monthly_spending", "Show monthly spending breakdown", (chatId) => {
        analyticsEngine.showMonthlyBreakdown(chatId);
    });

    registry.register("account_summary", "Show account summary", async (chatId) => {
        const msg = await buildAccountSummaryMessage(chatId);
        bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
    });



    registry.register("wallet_intelligence", "Check Circle Wallet intelligence", async (chatId) => {
        const address = walletStore.getWalletAddress(chatId);
        const walletId = walletStore.getWalletId(chatId);
        if (!address || !walletId) {
            bot.sendMessage(chatId, "You don't have a wallet yet. Try `create wallet` to get started.", { parse_mode: "Markdown" });
            return;
        }

        bot.sendMessage(chatId, "⏳ Fetching live wallet data from Circle...");

        try {
            // Fetch Native USDC Balance directly from Arc Contract
            const rawUsdcBalance = await usdc.balanceOf(address).catch(() => 0n);
            const arcUsdcBalance = ethers.formatUnits(rawUsdcBalance, 6);

            // Fetch Transactions from ArcScan Explorer API
            let recentCount = 0;
            try {
                const scanUrl = `https://testnet.arcscan.app/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc`;
                const txRes = await fetch(scanUrl);
                const txData = await txRes.json();

                if (txData && txData.status === "1" && Array.isArray(txData.result)) {
                    const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
                    // result timestamps are in seconds usually for EVM explorers
                    recentCount = txData.result.filter((t: any) => (parseInt(t.timeStamp) * 1000) > oneWeekAgo).length;
                }
            } catch (e) {
                console.error("ArcScan fetch error:", e);
            }

            let msg = `🔐 **Wallet Status (Arc Testnet)**\n\n`;
            msg += `Address: \`${address}\`\n`;
            msg += `Available balance: **${arcUsdcBalance} USDC**\n`;
            msg += `Transactions this week: **${recentCount}**\n\n`;

            msg += `_Connected transparently to Arc Network._`;
            bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
        } catch (error: any) {
            console.error("Wallet Intel error:", error);
            bot.sendMessage(chatId, "❌ Failed to fetch wallet intelligence.");
        }
    });

    registry.register("status", "Show account status", (chatId) => {
        const address = walletStore.getWalletAddress(chatId);
        if (address) {
            bot.sendMessage(chatId, `🔐 **Account Status**\n\nWallet: Active\nAddress: \`${address}\``, { parse_mode: "Markdown" });
        } else {
            bot.sendMessage(chatId, "You don't have a wallet yet. Try `create wallet` to get started.", { parse_mode: "Markdown" });
        }
    });

    registry.register("export_wallet", "Show wallet recovery details", (chatId) => {
        const address = walletStore.getWalletAddress(chatId);

        if (address) {
            bot.sendMessage(
                chatId,
                `ℹ️ **Wallet recovery details**\n\nYour wallet uses **Circle Developer-Controlled Wallets**.\n\nThis means ArcPay manages the wallet infrastructure for you. There is **no private key export** or seed phrase to download from the bot.\n\n**Wallet address:**\n\`${address}\`\n\n**How recovery works:**\n• If you still control this ArcPay account, you can access the same wallet again.\n• Recovery depends on ArcPay's secured wallet custody setup.\n• If you need a self-custody wallet, use a separate wallet app and send funds there.`,
                { parse_mode: "Markdown" }
            );
        } else {
            bot.sendMessage(chatId, "No wallet found yet. Try `create wallet` first, then ask for `wallet recovery` details.", { parse_mode: "Markdown" });
        }
    });

    registry.register("create_wallet", "Create a new wallet", async (chatId) => {
        if (walletStore.hasWallet(chatId)) {
            bot.sendMessage(chatId, `Your wallet already exists.\n\nAddress:\n${walletStore.getWalletAddress(chatId)}\n\nNext: try \`wallet balance\` or \`show wallet\`.`, { parse_mode: "Markdown" });
            return;
        }

        try {
            bot.sendMessage(chatId, "⏳ creating secure Circle wallet...");
            const address = await walletStore.createWallet(chatId);
            bot.sendMessage(chatId, `✅ Wallet created.\n\nAddress:\n${address}\n\nNext: save a vendor with \`save vendor jack 0x...\` or check \`wallet balance\`.`, { parse_mode: "Markdown" });
        } catch (error: any) {
            bot.sendMessage(chatId, `❌ Failed to create wallet: ${error.message}`);
        }
    });

    registry.register("show_wallet", "Show wallet address", (chatId) => {
        const address = walletStore.getWalletAddress(chatId);
        if (address) {
            bot.sendMessage(chatId, `Your wallet address:\n${address}\n\nNext: try \`wallet balance\` to check activity.`, { parse_mode: "Markdown" });
        } else {
            bot.sendMessage(chatId, "You don't have a wallet yet. Try `create wallet` to get started.", { parse_mode: "Markdown" });
        }
    });

    registry.register("greeting", "Greet user and show capabilities", (chatId, intent) => {
        bot.sendMessage(chatId, intent.message || "👋 Hello! Type /help to see what I can do.", { parse_mode: "Markdown" });
    });

    registry.register("acknowledgment", "Acknowledge user message", (chatId, intent) => {
        bot.sendMessage(chatId, intent.message || "You're welcome! 😊");
    });

    registry.register("chat", "Conversational response", (chatId, intent) => {
        bot.sendMessage(chatId, intent.message || "I'm here to help!", { parse_mode: "Markdown" });
    });

    registry.register("schedule_payment", "Schedule a future payment", (chatId, intent) => {
        if (!intent.amount || !intent.beneficiary) {
            bot.sendMessage(chatId, "Please specify the amount, recipient, and time.\nExample: `schedule payment 10 usdc to aws tomorrow`", { parse_mode: "Markdown" });
            return;
        }

        const beneficiaryInput = intent.beneficiary;
        if (beneficiaryInput.startsWith("0x") && !ethers.isAddress(beneficiaryInput)) {
            bot.sendMessage(chatId, "That wallet address looks invalid. Please send a full valid 0x address.");
            return;
        }

        const isDirectAddress = ethers.isAddress(beneficiaryInput);
        const scheduleAddress = isDirectAddress ? beneficiaryInput : vendorStore.getVendor(chatId, beneficiaryInput);
        const scheduleLabel = beneficiaryInput;

        if (!scheduleAddress) {
            bot.sendMessage(chatId, `❌ Vendor "${intent.beneficiary}" not found. Save it first, or use a full 0x wallet address.`);
            return;
        }

        // Parse the schedule time
        // 1. Try LLM-provided schedule_time field
        let timeStr = (intent as any).schedule_time || "";
        let scheduleTime = parseScheduleDate(timeStr);

        // 2. If LLM didn't provide a valid time, try to extract from the original user message
        if (!scheduleTime && conversationMemory) {
            const history = conversationMemory.getHistory(chatId);
            const lastUserMsg = [...history].reverse().find(m => m.role === "user")?.content || "";
            // Extract time expressions from the user message
            const timePatterns = [
                /(?:in\s+)?(\d+\s+(?:second|seconds|minute|minutes|hour|hours|day|days|week|weeks|sn|saniye|dk|dakika|saat|gün|gun|hafta))(?:\s+sonra[sına]*)?/i,
                /\b(?:tomorrow|yarın|yarin)\b/i,
                /\b(?:today|bugün|bugun)\b/i,
                /(?:next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))/i,
                // Also try plain numbers just in case the unit is stuck to it like 1dk
                /(\d+\s*(?:sn|saniye|dk|dakika|saat|g|gün|h|hafta))/i,
            ];
            for (const pattern of timePatterns) {
                const match = lastUserMsg.match(pattern);
                if (match) {
                    scheduleTime = parseScheduleDate(match[0]);
                    if (scheduleTime) {
                        timeStr = match[0];
                        break;
                    }
                }
            }
        }

        // 3. Ultimate fallback
        if (!scheduleTime) {
            scheduleTime = parseScheduleDate("tomorrow")!;
            timeStr = "tomorrow (default)";
        }

        const frequency = (intent as any).frequency || "once";

        console.log(`[Schedule] chatId=${chatId} time="${timeStr}" parsed=${new Date(scheduleTime).toLocaleString()} freq=${frequency}`);

        const schedule = scheduleStore.createSchedule(
            chatId, scheduleLabel, scheduleAddress,
            intent.amount, scheduleTime, frequency
        );
        const preferences = userPreferencesStore.getPreferences(chatId);

        bot.sendMessage(
            chatId,
            `✅ **Scheduled payment created**\n\nAmount: ${schedule.amount} USDC\nRecipient: **${schedule.vendor}**\nExecution: ${formatUserDateTime(schedule.nextExecution, preferences)}\nFrequency: ${schedule.frequency}\nID: \`${schedule.id}\`\n\nI’ll remind you when it’s due.`,
            { parse_mode: "Markdown" }
        );
    });

    registry.register("list_schedules", "List scheduled payments", (chatId) => {
        const schedules = scheduleStore.getSchedules(chatId);
        if (schedules.length === 0) {
            bot.sendMessage(chatId, "📅 No scheduled payments yet. Try `schedule payment 10 usdc to aws tomorrow`.", { parse_mode: "Markdown" });
            return;
        }

        let msg = "📅 **Scheduled payments**\n\n";
        const preferences = userPreferencesStore.getPreferences(chatId);
        for (const s of schedules) {
            msg += `• \`${s.id}\` — **${s.amount} USDC** → ${s.vendor} (${formatUserDateTime(s.nextExecution, preferences)}, ${s.frequency})\n`;
        }
        msg += `\nUse \`cancel schedule <id>\` to remove one.`;
        bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
    });

    registry.register("cancel_schedule", "Cancel a scheduled payment", (chatId, intent) => {
        if (!intent.name) {
            bot.sendMessage(chatId, "Please specify the schedule ID. Use `list schedules` to see IDs.", { parse_mode: "Markdown" });
            return;
        }
        const cancelled = scheduleStore.cancelSchedule(chatId, intent.name);
        if (cancelled) {
            bot.sendMessage(chatId, `✅ Schedule \`${intent.name}\` cancelled.`, { parse_mode: "Markdown" });
        } else {
            bot.sendMessage(chatId, `❌ Schedule "${intent.name}" not found.`);
        }
    });

    const toolRouter = new ToolRouter(bot, registry, sessionStore);

    setupHandlers(
        bot, walletStore, vendorStore, llmKeyStore,
        toolRouter, intentParser,
        paymentEngine, invoiceEngine, paymentRequestEngine,
        conversationMemory, scheduleStore, userPreferencesStore
    );
    markBotReady();

    if (shouldStartScheduler) {
        schedulerService.start();
        markSchedulerReady();
    }

    console.log("Bot initialized!");

    if (shouldStartHttp) {
        try {
            await startHealthServer(port);
            console.log(`[HTTP] Health server listening on port ${port}`);
        } catch (error) {
            console.error("[HTTP] Failed to start health server:", error);
            throw error;
        }
    }
}

if (process.env.NODE_ENV !== "test") {
    void main().catch((error) => {
        console.error("[App] Failed to initialize ArcPay Agent:", error);
        process.exit(1);
    });
}
