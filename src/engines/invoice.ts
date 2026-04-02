import { logger } from "../utils/logger";
import { nanoid } from "nanoid";
import type { InvoiceStore, InvoiceSession } from "../store/invoices";
import type { VendorStore } from "../store/vendors";
import type { ConversationMemory } from "../memory/conversation";
import type { LLMAuth } from "../llm/client";
import { requestJsonCompletion } from "../llm/client";

const SESSION_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

export interface InvoiceEngineDeps {
    invoices: InvoiceStore;
    vendors: VendorStore;
    memory: ConversationMemory;
    send: (chatId: number, text: string) => Promise<void>;
    sendCard: (chatId: number, text: string, keyboard: any[][]) => Promise<void>;
    getLLMAuth: (chatId: number) => Promise<LLMAuth | null>;
}

interface ParsedInvoice {
    vendor: string;
    amount: string;
    currency: string;
    invoiceNumber?: string;
    date?: string;
    lineItems?: string[];
}

export class InvoiceEngine {
    private deps: InvoiceEngineDeps;

    constructor(deps: InvoiceEngineDeps) {
        this.deps = deps;
    }

    /**
     * Start invoice analysis from uploaded file content.
     */
    async analyze(chatId: number, extractedText: string, messageId?: number): Promise<void> {
        const auth = await this.deps.getLLMAuth(chatId);
        if (!auth) {
            await this.deps.send(chatId, "Please set your LLM API key first with /llmkey.");
            return;
        }

        await this.deps.send(chatId, "Analyzing invoice...");

        try {
            const parsed = await this.parseInvoice(auth, extractedText);
            if (!parsed) {
                await this.deps.send(chatId, "I couldn't extract invoice details from this document. Please try a clearer image or PDF.");
                return;
            }

            const session: InvoiceSession = {
                id: nanoid(12),
                status: "analyzed",
                invoice: {
                    vendor: parsed.vendor,
                    amount: parsed.amount,
                    currency: parsed.currency,
                    detectedAmount: parsed.amount,
                    detectedCurrency: parsed.currency,
                    invoiceNumber: parsed.invoiceNumber,
                    date: parsed.date,
                },
                sourceMessageId: messageId,
                openedAt: Date.now(),
                expiresAt: Date.now() + SESSION_EXPIRY_MS,
            };

            // Risk assessment
            const risk = this.assessRisk(parsed, chatId);
            session.risk = risk;

            // Vendor resolution
            const vendorMatch = await this.deps.vendors.findVendor(chatId, parsed.vendor);
            session.resolution = {
                displayVendor: vendorMatch?.data.displayName || parsed.vendor,
                matchedVendorName: vendorMatch?.name,
                resolvedBeneficiary: vendorMatch?.data.address,
                canPreparePayment: !!vendorMatch?.data.address && risk.canPreparePayment,
            };

            // Determine settlement
            let settlementAmount = parsed.amount;
            let settlementCurrency = "USDC";

            if (parsed.currency.toUpperCase() === "EUR") {
                settlementCurrency = "EURC";
            } else if (parsed.currency.toUpperCase() !== "USD" && parsed.currency.toUpperCase() !== "USDC") {
                // Non-USD/EUR currency — keep as USDC, note in session
                session.status = "review_required";
            }
            session.invoice.settlementAmount = settlementAmount;
            session.invoice.settlementCurrency = settlementCurrency;

            if (risk.requiresOverride) {
                session.status = "awaiting_override";
            } else if (!vendorMatch) {
                session.status = "review_required";
            } else {
                session.status = "ready_to_prepare";
            }

            await this.deps.invoices.saveSession(chatId, session);
            this.deps.memory.setLastInvoice(chatId, parsed.vendor, parsed.amount, parsed.currency, parsed.invoiceNumber);

            // Send result card
            await this.sendInvoiceCard(chatId, session);

            logger.info(chatId, "[InvoiceEngine] Invoice analyzed", {
                vendor: parsed.vendor,
                amount: parsed.amount,
                currency: parsed.currency,
                risk: risk.level,
            });
        } catch (err: any) {
            logger.error(chatId, "[InvoiceEngine] Analysis error", { error: err.message });
            await this.deps.send(chatId, "Invoice analysis failed. Please try again.");
        }
    }

    /**
     * Handle invoice callback buttons.
     */
    async processCallback(chatId: number, action: string): Promise<{ preparePayment?: { vendor: string; amount: number; token: string } } | null> {
        const session = await this.deps.invoices.getSession(chatId);
        if (!session) {
            await this.deps.send(chatId, "No active invoice session.");
            return null;
        }

        if (action === "invoice_cancel") {
            await this.deps.invoices.updateStatus(chatId, "cancelled");
            await this.deps.send(chatId, "Invoice cancelled.");
            return null;
        }

        if (action === "invoice_override" && session.status === "awaiting_override") {
            session.status = session.resolution?.canPreparePayment ? "ready_to_prepare" : "review_required";
            await this.deps.invoices.saveSession(chatId, session);
            await this.sendInvoiceCard(chatId, session);
            return null;
        }

        if (action === "invoice_pay" && session.resolution?.canPreparePayment) {
            await this.deps.invoices.updateStatus(chatId, "awaiting_payment");
            return {
                preparePayment: {
                    vendor: session.resolution.resolvedBeneficiary!,
                    amount: parseFloat(session.invoice.settlementAmount || session.invoice.amount),
                    token: session.invoice.settlementCurrency || "USDC",
                },
            };
        }

        return null;
    }

    private async sendInvoiceCard(chatId: number, session: InvoiceSession): Promise<void> {
        const inv = session.invoice;
        const risk = session.risk;
        const res = session.resolution;

        let text = `Invoice Analysis\n\nVendor: ${res?.displayVendor || inv.vendor}`;
        text += `\nAmount: ${inv.amount} ${inv.currency}`;
        if (inv.invoiceNumber) text += `\nInvoice #: ${inv.invoiceNumber}`;
        if (inv.date) text += `\nDate: ${inv.date}`;

        if (risk) {
            text += `\n\nRisk: ${risk.level}`;
            if (risk.flags.length > 0) text += ` (${risk.flags.join(", ")})`;
        }

        if (res?.matchedVendorName) {
            text += `\n\nMatched vendor: ${res.displayVendor}`;
        } else {
            text += `\n\nVendor not in your address book. Save the vendor first to enable payment.`;
        }

        if (inv.settlementAmount && inv.settlementCurrency) {
            text += `\nSettlement: ${inv.settlementAmount} ${inv.settlementCurrency}`;
        }

        const buttons: any[][] = [];

        if (session.status === "awaiting_override") {
            buttons.push([
                { text: "Override & Continue", callback_data: "invoice_override" },
                { text: "Cancel", callback_data: "invoice_cancel" },
            ]);
        } else if (session.status === "ready_to_prepare" && res?.canPreparePayment) {
            buttons.push([
                { text: "Pay Invoice", callback_data: "invoice_pay" },
                { text: "Cancel", callback_data: "invoice_cancel" },
            ]);
        } else {
            buttons.push([{ text: "Cancel", callback_data: "invoice_cancel" }]);
        }

        await this.deps.sendCard(chatId, text, buttons);
    }

    private async parseInvoice(auth: LLMAuth, text: string): Promise<ParsedInvoice | null> {
        const messages = [
            {
                role: "system",
                content: `Extract invoice details from the provided text. Return JSON with fields: vendor (string), amount (string, numeric only), currency (string, e.g. USD/EUR/GBP), invoiceNumber (string, optional), date (string, optional). If you cannot extract, return {"error": "cannot parse"}.`,
            },
            { role: "user", content: text },
        ];

        const result = await requestJsonCompletion(auth, messages);
        if (!result) return null;

        try {
            const parsed = JSON.parse(result);
            if (parsed.error || !parsed.vendor || !parsed.amount || !parsed.currency) return null;
            return parsed as ParsedInvoice;
        } catch {
            return null;
        }
    }

    private assessRisk(parsed: ParsedInvoice, _chatId: number): InvoiceSession["risk"] & {} {
        const flags: string[] = [];
        const explanations: string[] = [];
        let score = 0;

        const amount = parseFloat(parsed.amount);
        if (amount > 10000) {
            flags.push("HIGH_AMOUNT");
            explanations.push("Amount exceeds $10,000");
            score += 40;
        } else if (amount > 1000) {
            flags.push("ELEVATED_AMOUNT");
            explanations.push("Amount exceeds $1,000");
            score += 15;
        }

        if (!parsed.invoiceNumber) {
            flags.push("NO_INVOICE_NUMBER");
            explanations.push("No invoice number detected");
            score += 10;
        }

        if (!parsed.date) {
            flags.push("NO_DATE");
            explanations.push("No invoice date detected");
            score += 5;
        }

        const curr = parsed.currency.toUpperCase();
        if (curr !== "USD" && curr !== "EUR" && curr !== "USDC" && curr !== "EURC") {
            flags.push("UNCOMMON_CURRENCY");
            explanations.push(`Currency ${curr} requires conversion`);
            score += 10;
        }

        let level: "SAFE" | "REVIEW" | "HIGH_RISK" = "SAFE";
        if (score >= 40) level = "HIGH_RISK";
        else if (score >= 15) level = "REVIEW";

        return {
            level,
            score,
            flags,
            explanations,
            canPreparePayment: level !== "HIGH_RISK",
            requiresOverride: level === "HIGH_RISK",
            blocked: false,
        };
    }
}
