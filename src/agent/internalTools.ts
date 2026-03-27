import { ethers } from "ethers";
import { ConversationMemory } from "./conversationMemory";
import { AnalyticsEngine } from "../engines/analyticsEngine";
import { InvoiceEngine } from "../engines/invoiceEngine";
import { ScheduleStore } from "../storage/schedules";
import { VendorStore } from "../storage/vendorStore";
import { WalletStore } from "../storage/walletStore";
import { PaymentLogStore } from "../storage/paymentLogs";
import { USDC } from "../blockchain/usdc";
import { getArcGasReserveUsdc } from "../blockchain/arcConfig";
import { RiskEngine } from "../engines/riskEngine";
import { AgentIdentityEngine } from "../engines/agentIdentityEngine";
import { PendingPaymentStore } from "../storage/pendingPayments";

export type InternalToolName =
    | "account_snapshot"
    | "wallet_summary"
    | "recent_payee"
    | "recent_payments"
    | "pending_payment_status"
    | "spending_summary"
    | "spending_change_summary"
    | "agent_operations_overview"
    | "invoice_context"
    | "invoice_risk"
    | "invoice_payment_checklist"
    | "vendor_lookup"
    | "schedule_summary"
    | "schedule_lookup"
    | "payment_feasibility"
    | "agent_registration_status"
    | "agent_identity"
    | "agent_validation_status";

export interface ToolResult {
    status: "success" | "needs_clarification" | "blocked" | "failed";
    summary: string;
    data?: Record<string, unknown>;
    references?: {
        vendor?: string;
        address?: string;
        period?: string;
        invoiceNumber?: string;
        amount?: string;
        lastFocus?: string;
        scheduleId?: string;
    };
}

interface InternalToolDependencies {
    walletStore: WalletStore;
    vendorStore: VendorStore;
    analyticsEngine: AnalyticsEngine;
    paymentLogs: PaymentLogStore;
    scheduleStore: ScheduleStore;
    invoiceEngine: InvoiceEngine;
    conversationMemory?: ConversationMemory;
    usdc: USDC;
    eurc?: USDC;
    agentIdentityEngine?: AgentIdentityEngine;
    pendingPaymentStore?: PendingPaymentStore;
}

interface ResolvedPaymentRecipient {
    label: string;
    vendor: string | null;
    address: string | null;
}

export class InternalToolset {
    constructor(private deps: InternalToolDependencies) { }

    closeInvoiceSession(chatId: number): void {
        this.deps.invoiceEngine.closeSession(chatId, "closed");
    }

    markInvoiceOverrideRequested(chatId: number): void {
        this.deps.invoiceEngine.markSessionAwaitingOverride(chatId);
    }

    markInvoiceAwaitingPaymentConfirmation(chatId: number, sessionId?: string): void {
        this.deps.invoiceEngine.markSessionAwaitingPaymentConfirmation(chatId, sessionId);
    }

    async execute(chatId: number, tool: InternalToolName, args: Record<string, unknown> = {}): Promise<ToolResult> {
        switch (tool) {
            case "account_snapshot":
                return await this.accountSnapshot(chatId);
            case "wallet_summary":
                return await this.walletSummary(chatId);
            case "recent_payee":
                return this.recentPayee(chatId);
            case "recent_payments":
                return this.recentPayments(chatId, args);
            case "pending_payment_status":
                return this.pendingPaymentStatus(chatId);
            case "spending_summary":
                return this.spendingSummary(chatId, args);
            case "spending_change_summary":
                return this.spendingChangeSummary(chatId, args);
            case "agent_operations_overview":
                return this.agentOperationsOverview(chatId);
            case "invoice_context":
                return this.invoiceContext(chatId);
            case "invoice_risk":
                return this.invoiceRisk(chatId);
            case "invoice_payment_checklist":
                return await this.invoicePaymentChecklist(chatId);
            case "vendor_lookup":
                return this.vendorLookup(chatId, args);
            case "schedule_summary":
                return this.scheduleSummary(chatId);
            case "schedule_lookup":
                return this.scheduleLookup(chatId);
            case "payment_feasibility":
                return await this.paymentFeasibility(chatId, args);
            case "agent_registration_status":
                return await this.agentRegistrationStatus();
            case "agent_identity":
                return await this.agentIdentity();
            case "agent_validation_status":
                return await this.agentValidationStatus();
            default:
                return {
                    status: "failed",
                    summary: `Unsupported internal tool: ${tool}`
                };
        }
    }

    private normalizePeriod(raw: unknown): "week" | "month" | "all" {
        if (typeof raw !== "string") return "month";
        const value = raw.toLowerCase();
        if (value.includes("week")) return "week";
        if (value.includes("all")) return "all";
        return "month";
    }

    private getSince(period: "week" | "month" | "all"): number | undefined {
        const now = Date.now();
        if (period === "week") return now - 7 * 24 * 60 * 60 * 1000;
        if (period === "month") return now - 30 * 24 * 60 * 60 * 1000;
        return undefined;
    }

    private getWindowMs(period: "week" | "month" | "all"): number {
        if (period === "week") return 7 * 24 * 60 * 60 * 1000;
        return 30 * 24 * 60 * 60 * 1000;
    }

    private resolvePaymentRecipient(
        chatId: number,
        payment: { vendor: string | null; address: string }
    ): ResolvedPaymentRecipient {
        const resolvedVendor = payment.vendor
            ? this.deps.vendorStore.resolveVendor(chatId, payment.vendor)
            : null;
        const address = resolvedVendor?.data.address || payment.address || null;
        const displayName = payment.vendor
            ? this.deps.vendorStore.getVendorDisplayName?.(chatId, payment.vendor) || resolvedVendor?.data.displayName || payment.vendor
            : (address
                ? this.deps.vendorStore.getVendorDisplayNameByAddress?.(chatId, address)
                    || this.deps.vendorStore.getVendorNameByAddress(chatId, address)
                : null);

        return {
            label: displayName || `${payment.address.slice(0, 10)}...`,
            vendor: displayName || payment.vendor,
            address
        };
    }

    private async walletSummary(chatId: number): Promise<ToolResult> {
        const address = this.deps.walletStore.getWalletAddress(chatId);
        if (!address) {
            return {
                status: "blocked",
                summary: "There isn't a wallet set up yet."
            };
        }

        const [usdcBalance, eurcBalance] = await Promise.all([
            this.deps.usdc.balanceOf(address),
            this.deps.eurc ? this.deps.eurc.balanceOf(address) : Promise.resolve(0n)
        ]);
        const usdcFormatted = ethers.formatUnits(usdcBalance, 6);
        const eurcFormatted = ethers.formatUnits(eurcBalance, 6);
        return {
            status: "success",
            summary: `Wallet ${address} holds ${usdcFormatted} USDC and ${eurcFormatted} EURC.`,
            data: {
                address,
                balance: usdcFormatted,
                eurcBalance: eurcFormatted
            },
            references: {
                address
            }
        };
    }

    private async accountSnapshot(chatId: number): Promise<ToolResult> {
        const address = this.deps.walletStore.getWalletAddress(chatId);
        const vendors = this.deps.vendorStore.getVendorsWithStats?.(chatId) || this.deps.vendorStore.getVendors?.(chatId) || {};
        const vendorCount = Object.keys(vendors).length;
        const activeSchedules = this.deps.scheduleStore.getSchedules(chatId).length;
        const recentPayments = this.deps.paymentLogs.getRecentPayments(chatId, 3);
        const recordedPayments = this.deps.paymentLogs.getPayments(chatId).length;
        const spent30d = this.deps.analyticsEngine.getTotalSpending?.(chatId, Date.now() - 30 * 24 * 60 * 60 * 1000) ?? 0;
        const topVendor = this.deps.analyticsEngine.getSpendingByVendor?.(chatId, Date.now() - 30 * 24 * 60 * 60 * 1000)?.[0];

        if (!address) {
            return {
                status: "blocked",
                summary: "There isn't a wallet set up yet. Once a wallet exists, I can summarize your balance, recent payments, vendors, and schedules.",
                data: {
                    walletConfigured: false,
                    savedVendorCount: vendorCount,
                    activeScheduleCount: activeSchedules,
                    paymentHistoryCount: recordedPayments
                }
            };
        }

        const [balance, eurcBalance] = await Promise.all([
            this.deps.usdc.balanceOf(address).catch(() => 0n),
            this.deps.eurc ? this.deps.eurc.balanceOf(address).catch(() => 0n) : Promise.resolve(0n)
        ]);
        const lastPayment = recentPayments[recentPayments.length - 1];
        const recipient = lastPayment ? this.resolvePaymentRecipient(chatId, lastPayment) : null;
        const lastPayToken = lastPayment?.token ?? "USDC";

        return {
            status: "success",
            summary: `Account snapshot: wallet ${address} holds ${ethers.formatUnits(balance, 6)} USDC and ${ethers.formatUnits(eurcBalance, 6)} EURC. In the last 30 days you've spent ${spent30d} USDC, recorded ${recordedPayments} payments, saved ${vendorCount} vendors, and have ${activeSchedules} active schedules.${topVendor ? ` Top vendor: ${topVendor.vendor} (${topVendor.total} USDC).` : ""}${recipient && lastPayment ? ` Latest payment: ${lastPayment.amount} ${lastPayToken} to ${recipient.label}.` : ""}`,
            data: {
                address,
                balance: ethers.formatUnits(balance, 6),
                eurcBalance: ethers.formatUnits(eurcBalance, 6),
                spent30d,
                recordedPayments,
                vendorCount,
                activeSchedules,
                topVendor: topVendor || null,
                lastPayment: lastPayment
                    ? {
                        amount: lastPayment.amount,
                        vendor: recipient?.vendor || lastPayment.vendor,
                        address: recipient?.address || lastPayment.address
                    }
                    : null
            },
            references: {
                address,
                vendor: recipient?.vendor || topVendor?.vendor,
                lastFocus: "account_summary"
            }
        };
    }

    private agentOperationsOverview(chatId: number): ToolResult {
        const walletAddress = this.deps.walletStore.getWalletAddress(chatId);
        const vendorCount = Object.keys(this.deps.vendorStore.getVendors(chatId) || {}).length;
        const scheduleCount = this.deps.scheduleStore.getSchedules(chatId).length;
        const paymentCount = this.deps.paymentLogs.getPayments(chatId).length;
        const activeInvoice = this.deps.invoiceEngine.getActiveSession(chatId);
        const identityStatus = this.deps.agentIdentityEngine?.getStatus?.();
        const invoiceStatus = activeInvoice?.status || "none";
        const identityPhrase = !identityStatus
            ? "agent identity unavailable in this runtime"
            : identityStatus.registered
                ? `agent identity registered${identityStatus.agentId ? ` (${identityStatus.agentId})` : ""}`
                : identityStatus.configured
                    ? "agent identity configured but not registered"
                    : "agent identity not configured";

        return {
            status: "success",
            summary: `Arc Pay Agent is a Telegram-first Arc Testnet payment agent. It uses an LLM-orchestrated runtime: the LLM parses intent and dispatches to deterministic engines for payments, schedules, invoices, vendors, analytics, wallet checks, history, and agent identity. Money movement always stops at explicit confirmation. It uses Circle developer-controlled wallets and keeps invoice review state inside an active invoice session. Current state for this account: wallet ${walletAddress ? "configured" : "not set up"}, ${vendorCount} saved vendors, ${scheduleCount} active schedules, ${paymentCount} recorded payments, active invoice ${invoiceStatus}, ${identityPhrase}.`,
            data: {
                transport: "telegram",
                chain: "Arc Testnet",
                runtimeModel: "llm_orchestrated",
                walletModel: "Circle developer-controlled wallets",
                paymentConfirmationRequired: true,
                invoiceSessionModel: "single active invoice session per chat",
                walletConfigured: Boolean(walletAddress),
                walletAddress,
                savedVendorCount: vendorCount,
                activeScheduleCount: scheduleCount,
                paymentHistoryCount: paymentCount,
                activeInvoiceStatus: invoiceStatus,
                activeInvoiceVendor: activeInvoice?.invoice?.vendor || null,
                agentIdentityConfigured: Boolean(identityStatus?.configured),
                agentIdentityRegistered: Boolean(identityStatus?.registered),
                agentId: identityStatus?.agentId || null,
                docs: {
                    architecture: "ARCHITECTURE.md",
                    capabilityMatrix: "AGENT_CAPABILITY_MATRIX.md"
                }
            }
        };
    }

    private recentPayee(chatId: number): ToolResult {
        const payments = this.deps.paymentLogs.getRecentPayments(chatId, 5);
        if (payments.length === 0) {
            return {
                status: "blocked",
                summary: "There aren't any recorded payments yet, so I can't identify a recent payee."
            };
        }

        const latest = payments[payments.length - 1];
        const recipient = this.resolvePaymentRecipient(chatId, latest);
        return {
            status: "success",
            summary: `Your most recent payee was ${recipient.label}. The last recorded payment there was ${latest.amount} USDC.`,
            data: {
                vendor: recipient.vendor || null,
                address: recipient.address || latest.address,
                amount: latest.amount,
                payment: latest
            },
            references: {
                vendor: recipient.vendor || undefined,
                address: recipient.address || latest.address,
                amount: String(latest.amount),
                lastFocus: "recent_payee"
            }
        };
    }

    private recentPayments(chatId: number, args: Record<string, unknown>): ToolResult {
        const limit = typeof args.limit === "number" && args.limit > 0 ? Math.min(10, Math.floor(args.limit)) : 5;
        const payments = this.deps.paymentLogs.getRecentPayments(chatId, limit);

        if (payments.length === 0) {
            return {
                status: "blocked",
                summary: "There aren't any recorded payments yet."
            };
        }

        const resolvedPayments = payments.map((payment) => {
            const recipient = this.resolvePaymentRecipient(chatId, payment);
            return {
                ...payment,
                vendor: recipient.vendor || payment.vendor,
                address: recipient.address || payment.address
            };
        });

        const last = resolvedPayments[resolvedPayments.length - 1];
        const target = last.vendor || last.address;
        const lastToken = last.token ?? "USDC";
        return {
            status: "success",
            summary: target
                ? `The latest recorded payment was ${last.amount} ${lastToken} to ${target}.`
                : "I found recent payments, but I couldn't resolve the latest recipient cleanly.",
            data: {
                payments: resolvedPayments
            },
            references: {
                vendor: last.vendor || undefined,
                address: last.address,
                amount: String(last.amount),
                lastFocus: "recent_payment"
            }
        };
    }

    private pendingPaymentStatus(chatId: number): ToolResult {
        const pending = this.deps.pendingPaymentStore?.getPendingPayment(chatId);
        if (!pending) {
            return {
                status: "blocked",
                summary: "There isn't a payment waiting for confirmation right now."
            };
        }

        const pendingToken = pending.token ?? "USDC";
        return {
            status: "success",
            summary: `There is a payment waiting for confirmation: ${pending.amountStr} ${pendingToken}${pending.vendorName ? ` to ${pending.vendorName}` : ""}.`,
            data: {
                pending
            },
            references: {
                vendor: pending.vendorName || undefined,
                amount: pending.amountStr,
                lastFocus: "pending_payment"
            }
        };
    }

    private spendingSummary(chatId: number, args: Record<string, unknown>): ToolResult {
        const period = this.normalizePeriod(args.period);
        const topOnly = Boolean(args.topOnly);
        const since = this.getSince(period);
        const payments = since
            ? this.deps.paymentLogs.getPaymentsSince(chatId, since)
            : this.deps.paymentLogs.getPayments(chatId);

        const grouped = new Map<string, { label: string; vendor: string | null; address: string | null; total: number; count: number }>();
        for (const payment of payments) {
            const recipient = this.resolvePaymentRecipient(chatId, payment);
            const vendorKey = recipient.vendor || (recipient.label.startsWith("0x") ? null : recipient.label);
            const key = vendorKey
                ? `vendor:${vendorKey.toLowerCase()}`
                : `address:${(recipient.address || payment.address).toLowerCase()}`;
            const existing = grouped.get(key);
            if (existing) {
                existing.total += payment.amount;
                existing.count += 1;
                if (!existing.vendor && recipient.vendor) {
                    existing.vendor = recipient.vendor;
                }
                if (!existing.address && recipient.address) {
                    existing.address = recipient.address;
                }
                if (existing.label.startsWith("0x") && !recipient.label.startsWith("0x")) {
                    existing.label = recipient.label;
                }
                continue;
            }

            grouped.set(key, {
                label: recipient.label,
                vendor: recipient.vendor,
                address: recipient.address || payment.address,
                total: payment.amount,
                count: 1
            });
        }

        const spending = Array.from(grouped.values())
            .sort((a, b) => b.total - a.total);

        if (spending.length === 0) {
            return {
                status: "blocked",
                summary: `There isn't any spending data for the selected period (${period}).`
            };
        }

        const total = this.deps.analyticsEngine.getTotalSpending(chatId, since);
        const top = spending[0];

        if (topOnly) {
            return {
                status: "success",
                summary: `The top payee for the last ${period === "all" ? "recorded period" : period} was ${top.label}: ${top.total} USDC across ${top.count} payments.`,
                data: {
                    topVendor: top,
                    total
                },
                references: {
                    vendor: top.vendor || undefined,
                    address: top.address || undefined,
                    period
                }
            };
        }

        return {
            status: "success",
            summary: `Total spending for the last ${period === "all" ? "recorded period" : period} is ${total} USDC. Top payees: ${spending.slice(0, 3).map((entry) => `${entry.label} (${entry.total} USDC)`).join(", ")}.`,
            data: {
                total,
                spending
            },
            references: {
                vendor: top.vendor || undefined,
                address: top.address || undefined,
                period
            }
        };
    }

    private spendingChangeSummary(chatId: number, args: Record<string, unknown>): ToolResult {
        const requestedPeriod = this.normalizePeriod(args.period);
        const period = requestedPeriod === "all" ? "month" : requestedPeriod;
        const windowMs = this.getWindowMs(period);
        const now = Date.now();
        const currentSince = now - windowMs;
        const previousSince = currentSince - windowMs;
        const allPayments = this.deps.paymentLogs.getPayments(chatId);
        const currentPayments = allPayments.filter((payment) => payment.timestamp >= currentSince);
        const previousPayments = allPayments.filter((payment) => payment.timestamp >= previousSince && payment.timestamp < currentSince);

        if (currentPayments.length === 0 && previousPayments.length === 0) {
            return {
                status: "blocked",
                summary: `There isn't enough recent payment history to compare the last ${period}.`
            };
        }

        const currentTotal = currentPayments.reduce((sum, payment) => sum + payment.amount, 0);
        const previousTotal = previousPayments.reduce((sum, payment) => sum + payment.amount, 0);
        const delta = Number((currentTotal - previousTotal).toFixed(6));
        const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
        const topCurrentRecipient = currentPayments.length > 0
            ? currentPayments
                .map((payment) => ({
                    ...payment,
                    recipient: this.resolvePaymentRecipient(chatId, payment)
                }))
                .reduce<Map<string, { label: string; vendor?: string; address?: string; total: number; count: number }>>((acc, payment) => {
                    const label = payment.recipient.label;
                    const key = (payment.recipient.vendor || payment.recipient.address || label).toLowerCase();
                    const existing = acc.get(key);
                    if (existing) {
                        existing.total += payment.amount;
                        existing.count += 1;
                        return acc;
                    }

                    acc.set(key, {
                        label,
                        vendor: payment.recipient.vendor || undefined,
                        address: payment.recipient.address || undefined,
                        total: payment.amount,
                        count: 1
                    });
                    return acc;
                }, new Map())
            : new Map();
        const topCurrent = Array.from(topCurrentRecipient.values()).sort((left, right) => right.total - left.total)[0];
        const periodLabel = period === "week" ? "7 days" : "30 days";
        const movement = direction === "flat"
            ? `Spending is flat versus the previous ${periodLabel}: ${currentTotal} USDC in both periods.`
            : previousTotal === 0
                ? `You spent ${currentTotal} USDC in the last ${periodLabel}. There isn't an earlier ${periodLabel} baseline yet.`
                : `Spending is ${direction} by ${Math.abs(delta)} USDC versus the previous ${periodLabel} (${currentTotal} USDC vs ${previousTotal} USDC).`;
        const topLine = topCurrent
            ? ` Biggest recent payee: ${topCurrent.label} at ${topCurrent.total} USDC across ${topCurrent.count} payment${topCurrent.count === 1 ? "" : "s"}.`
            : "";

        return {
            status: "success",
            summary: `${movement}${topLine}`.trim(),
            data: {
                period,
                currentTotal,
                previousTotal,
                delta,
                direction,
                currentPayments: currentPayments.length,
                previousPayments: previousPayments.length,
                topPayee: topCurrent || null
            },
            references: {
                vendor: topCurrent?.vendor,
                address: topCurrent?.address,
                period
            }
        };
    }

    private invoiceContext(chatId: number): ToolResult {
        const session = this.deps.invoiceEngine.getActiveSession(chatId);
        const lastInvoice = this.deps.conversationMemory?.getContext(chatId).lastInvoice;

        if (!session && !lastInvoice) {
            return {
                status: "blocked",
                summary: "There isn't a recent invoice in context right now."
            };
        }

        if (session) {
            const invoice = session.invoice;
            const amount = invoice.settlementAmount || invoice.amount || invoice.detectedAmount || "unknown";
            const currency = invoice.settlementCurrency || invoice.currency || invoice.detectedCurrency || "USDC";
            const vendor = session.resolution.matchedVendorName || invoice.vendor || "Unknown vendor";
            const requiresOverride = session.status === "review_required" || session.status === "awaiting_override";
            const blocked = Boolean(session.risk?.blocked);
            const readyToPrepare = session.resolution.canPreparePayment && !requiresOverride && !blocked;

            return {
                status: "success",
                summary: `The active invoice is ${vendor} for ${amount} ${currency}${invoice.invoiceNumber ? ` (invoice #${invoice.invoiceNumber})` : ""}.`,
                data: {
                    active: true,
                    status: session.status,
                    invoice,
                    amount,
                    currency,
                    vendor,
                    resolvedBeneficiary: session.resolution.resolvedBeneficiary,
                    canPreparePayment: session.resolution.canPreparePayment,
                    readyToPrepare: readyToPrepare,
                    requiresOverride,
                    blocked,
                    riskLevel: session.risk?.level || null,
                    sessionId: session.id
                },
                references: {
                    vendor,
                    address: session.resolution.resolvedBeneficiary || undefined,
                    invoiceNumber: invoice.invoiceNumber || undefined
                }
            };
        }

        const invoice = lastInvoice!;
        const amount = invoice.settlementAmount || invoice.amount || invoice.detectedAmount || "unknown";
        const currency = invoice.settlementCurrency || invoice.currency || invoice.detectedCurrency || "USDC";
        const vendor = invoice.vendor || "Unknown vendor";
        return {
            status: "success",
            summary: `The last analyzed invoice was ${vendor} for ${amount} ${currency}${invoice.invoiceNumber ? ` (invoice #${invoice.invoiceNumber})` : ""}, but it isn't active anymore.`,
            data: {
                active: false,
                status: "closed",
                invoice,
                amount,
                currency,
                vendor,
                resolvedBeneficiary: null,
                canPreparePayment: false,
                requiresOverride: false,
                blocked: false,
                riskLevel: null,
                sessionId: null
            },
            references: {
                vendor,
                invoiceNumber: invoice.invoiceNumber || undefined
            }
        };
    }

    private invoiceRisk(chatId: number): ToolResult {
        const session = this.deps.invoiceEngine.getActiveSession(chatId);
        if (!session || !session.risk || !session.rawRisk) {
            return {
                status: "blocked",
                summary: "There isn't an invoice risk result in context right now."
            };
        }

        const risk = session.rawRisk;
        const invoice = session.invoice;
        const vendor = invoice.vendor || "Unknown vendor";
        const displayVendor = session.resolution.matchedVendorName || vendor;
        const settlementAmount = invoice.settlementAmount || invoice.amount || invoice.detectedAmount || null;
        const settlementCurrency = invoice.settlementCurrency || invoice.currency || invoice.detectedCurrency || "USDC";
        const requiresOverride = session.status === "review_required" || session.status === "awaiting_override";
        const blocked = Boolean(session.risk.blocked);
        const readyToPrepare = session.resolution.canPreparePayment && !requiresOverride && !blocked;
        return {
            status: "success",
            summary: RiskEngine.formatConversationalSummary(displayVendor, risk, {
                canPreparePayment: readyToPrepare,
                settlementAmount,
                settlementCurrency
            }),
            data: {
                active: true,
                status: session.status,
                risk: {
                    level: session.risk.level,
                    flags: session.risk.flags,
                    riskScore: session.risk.riskScore
                },
                invoice,
                explanations: session.risk.explanations,
                displayVendor,
                settlementAmount,
                settlementCurrency,
                canPreparePayment: session.resolution.canPreparePayment,
                readyToPrepare: readyToPrepare,
                requiresOverride,
                blocked,
                sessionId: session.id
            },
            references: {
                vendor: displayVendor,
                invoiceNumber: invoice.invoiceNumber || undefined
            }
        };
    }

    private async invoicePaymentChecklist(chatId: number): Promise<ToolResult> {
        const session = this.deps.invoiceEngine.getActiveSession(chatId);
        if (!session) {
            return {
                status: "blocked",
                summary: "There isn't an active invoice in context right now."
            };
        }

        const invoice = session.invoice;
        const vendor = session.resolution.matchedVendorName || invoice.vendor || "Unknown vendor";
        const amount = invoice.settlementAmount || invoice.amount || invoice.detectedAmount || null;
        const currency = invoice.settlementCurrency || invoice.currency || invoice.detectedCurrency || "USDC";
        const invoiceNumber = invoice.invoiceNumber || undefined;
        const resolvedBeneficiary = session.resolution.resolvedBeneficiary || undefined;
        const riskFlags = session.risk?.flags || [];
        const blocked = Boolean(session.risk?.blocked);
        const requiresOverride = session.status === "review_required" || session.status === "awaiting_override";
        const readyToPrepare = Boolean(session.resolution.canPreparePayment) && !blocked && !requiresOverride;

        const checks: string[] = [
            `vendor ${resolvedBeneficiary ? "resolved" : "still needs confirmation"}`,
            `amount ${amount ? `${amount} ${currency}` : "still needs confirmation"}`,
            `invoice number ${invoiceNumber || "not detected"}`
        ];

        let enoughBalance: boolean | null = null;
        let balanceText: string | null = null;
        let requiredText: string | null = null;
        const walletAddress = this.deps.walletStore.getWalletAddress(chatId);
        const parsedAmount = amount !== null ? Number(amount) : NaN;
        if (walletAddress && resolvedBeneficiary && Number.isFinite(parsedAmount) && parsedAmount > 0) {
            const balance = await this.deps.usdc.balanceOf(walletAddress);
            const amountUnits = ethers.parseUnits(parsedAmount.toString(), 6);
            const gasReserve = getArcGasReserveUsdc();
            const required = amountUnits + gasReserve;
            enoughBalance = balance >= required;
            balanceText = ethers.formatUnits(balance, 6);
            requiredText = ethers.formatUnits(required, 6);
            checks.push(`wallet balance ${enoughBalance ? "covers the payment plus Arc gas reserve" : "is too low for the payment plus Arc gas reserve"}`);
        }

        const statusLine = blocked
            ? `Right now this invoice is blocked by risk checks${riskFlags.length > 0 ? ` (${riskFlags.join(", ")})` : ""}.`
            : requiresOverride
                ? `Right now this invoice still needs review before payment${riskFlags.length > 0 ? ` (${riskFlags.join(", ")})` : ""}.`
                : readyToPrepare
                    ? "Right now this invoice looks ready to prepare for payment."
                    : "Right now this invoice still needs a few details checked before payment.";
        const balanceLine = balanceText && requiredText
            ? ` Wallet balance: ${balanceText} USDC; required including Arc gas reserve: ${requiredText} USDC.`
            : "";

        return {
            status: "success",
            summary: `Before paying this invoice, check the vendor, amount, invoice number, risk review, and wallet balance. ${statusLine}${balanceLine}`.trim(),
            data: {
                vendor,
                amount,
                currency,
                invoiceNumber: invoiceNumber || null,
                resolvedBeneficiary: resolvedBeneficiary || null,
                blocked,
                requiresOverride,
                readyToPrepare,
                riskLevel: session.risk?.level || null,
                riskFlags,
                checks,
                enoughBalance,
                balance: balanceText,
                requiredBalance: requiredText
            },
            references: {
                vendor,
                address: resolvedBeneficiary,
                invoiceNumber
            }
        };
    }

    private vendorLookup(chatId: number, args: Record<string, unknown>): ToolResult {
        const name = typeof args.name === "string" ? args.name.trim() : "";
        const address = typeof args.address === "string" ? args.address.trim() : "";
        if (!name && !address) {
            return {
                status: "needs_clarification",
                summary: "Tell me which vendor you want me to look up."
            };
        }

        const resolvedName = name
            || this.deps.vendorStore.getVendorDisplayNameByAddress?.(chatId, address)
            || this.deps.vendorStore.getVendorNameByAddress(chatId, address)
            || "";
        const data = resolvedName ? this.deps.vendorStore.getVendorData(chatId, resolvedName) : null;
        if (!data) {
            return {
                status: "blocked",
                summary: name
                    ? `${name} isn't saved as a vendor yet.`
                    : `${address} isn't saved as a vendor yet.`
            };
        }

        const displayName = this.deps.vendorStore.getVendorDisplayName(chatId, resolvedName) || resolvedName;

        return {
            status: "success",
            summary: `${displayName} resolves to ${data.address} and has ${data.totalPaid} USDC in recorded payments.`,
            data: {
                name: displayName,
                vendor: data
            },
            references: {
                vendor: displayName,
                address: data.address
            }
        };
    }

    private scheduleLookup(chatId: number): ToolResult {
        const schedules = this.deps.scheduleStore.getSchedules(chatId);
        if (schedules.length === 0) {
            return {
                status: "blocked",
                summary: "There aren't any active schedules."
            };
        }

        const first = schedules[0];
        return {
            status: "success",
            summary: `Active schedules: ${schedules.slice(0, 5).map((schedule) => `${schedule.amount} USDC to ${schedule.vendor} (${schedule.id})`).join("; ")}.`,
            data: {
                schedules
            },
            references: {
                vendor: first.vendor,
                address: first.address,
                scheduleId: first.id,
                amount: String(first.amount),
                lastFocus: "schedule_summary"
            }
        };
    }

    private scheduleSummary(chatId: number): ToolResult {
        const schedules = this.deps.scheduleStore.getSchedules(chatId);
        if (schedules.length === 0) {
            return {
                status: "blocked",
                summary: "There aren't any active schedules right now."
            };
        }

        const nextSchedule = schedules
            .slice()
            .sort((left, right) => left.nextExecution - right.nextExecution)[0];

        return {
            status: "success",
            summary: `You have ${schedules.length} active schedule${schedules.length === 1 ? "" : "s"}. The next one is ${nextSchedule.amount} USDC to ${nextSchedule.vendor} (${nextSchedule.id}).`,
            data: {
                schedules,
                count: schedules.length,
                nextSchedule
            },
            references: {
                vendor: nextSchedule.vendor,
                address: nextSchedule.address,
                scheduleId: nextSchedule.id,
                amount: String(nextSchedule.amount),
                lastFocus: "schedule_summary"
            }
        };
    }

    private async paymentFeasibility(chatId: number, args: Record<string, unknown>): Promise<ToolResult> {
        const amount = typeof args.amount === "number" ? args.amount : NaN;
        const beneficiary = typeof args.beneficiary === "string" ? args.beneficiary.trim() : "";

        if (!Number.isFinite(amount) || amount <= 0 || !beneficiary) {
            return {
                status: "needs_clarification",
                summary: "Tell me the amount and recipient first, then I can check the balance."
            };
        }

        const address = this.deps.walletStore.getWalletAddress(chatId);
        if (!address) {
            return {
                status: "blocked",
                summary: "There isn't a wallet set up yet."
            };
        }

        const recipientAddress = ethers.isAddress(beneficiary)
            ? beneficiary
            : this.deps.vendorStore.getVendor(chatId, beneficiary);

        if (!recipientAddress) {
            return {
                status: "blocked",
                summary: `I couldn't resolve ${beneficiary} to a saved vendor or wallet address.`
            };
        }

        const balance = await this.deps.usdc.balanceOf(address);
        const amountUnits = ethers.parseUnits(amount.toString(), 6);
        const gasReserve = getArcGasReserveUsdc();
        const totalRequired = amountUnits + gasReserve;
        const enough = balance >= totalRequired;

        if (!enough) {
            return {
                status: "blocked",
                summary: `The wallet balance is too low. Required: ${ethers.formatUnits(totalRequired, 6)} USDC including Arc gas reserve. Available: ${ethers.formatUnits(balance, 6)} USDC.`,
                data: {
                    balance: ethers.formatUnits(balance, 6),
                    required: ethers.formatUnits(totalRequired, 6),
                    gasReserve: ethers.formatUnits(gasReserve, 6)
                },
                references: {
                    vendor: beneficiary && !ethers.isAddress(beneficiary) ? beneficiary : undefined,
                    address: recipientAddress,
                    amount: String(amount),
                    lastFocus: "payment_feasibility"
                }
            };
        }

        return {
            status: "success",
            summary: `The wallet has enough balance to prepare ${amount} USDC to ${beneficiary}. Required including Arc gas reserve: ${ethers.formatUnits(totalRequired, 6)} USDC. Available: ${ethers.formatUnits(balance, 6)} USDC.`,
            data: {
                balance: ethers.formatUnits(balance, 6),
                required: ethers.formatUnits(totalRequired, 6),
                gasReserve: ethers.formatUnits(gasReserve, 6),
                beneficiary: recipientAddress,
                amount
            },
            references: {
                vendor: beneficiary && !ethers.isAddress(beneficiary) ? beneficiary : undefined,
                address: recipientAddress,
                amount: String(amount),
                lastFocus: "payment_feasibility"
            }
        };
    }

    private async agentRegistrationStatus(): Promise<ToolResult> {
        const engine = this.deps.agentIdentityEngine;
        if (!engine) {
            return {
                status: "blocked",
                summary: "Arc Pay Agent registration is not configured in this runtime."
            };
        }

        const status = engine.getStatus();
        return {
            status: "success",
            summary: await engine.getStatusSummary(),
            data: status as unknown as Record<string, unknown>
        };
    }

    private async agentIdentity(): Promise<ToolResult> {
        const engine = this.deps.agentIdentityEngine;
        if (!engine) {
            return {
                status: "blocked",
                summary: "Arc Pay Agent identity details are not available in this runtime."
            };
        }

        const details = await engine.getIdentityDetails();
        const status = engine.getStatus();
        return {
            status: "success",
            summary: status.registered
                ? `Arc Pay Agent identity: agent ${status.agentId} owned by ${status.ownerWalletAddress}.`
                : "Arc Pay Agent does not have a registered onchain identity yet.",
            data: details,
            references: {
                address: typeof details.ownerWalletAddress === "string" ? details.ownerWalletAddress : undefined
            }
        };
    }

    private async agentValidationStatus(): Promise<ToolResult> {
        const engine = this.deps.agentIdentityEngine;
        if (!engine) {
            return {
                status: "blocked",
                summary: "Arc Pay Agent validation status is not available in this runtime."
            };
        }

        const status = engine.getStatus();
        return {
            status: "success",
            summary: await engine.getValidationSummary(),
            data: status as unknown as Record<string, unknown>
        };
    }
}
