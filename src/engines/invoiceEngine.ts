import TelegramBot from "node-telegram-bot-api";
import { ethers } from "ethers";
import { randomUUID } from "node:crypto";
import { InvoiceStore } from "../storage/invoiceStore";
import { VendorStore } from "../storage/vendorStore";
import { RiskEngine, RiskResult } from "./riskEngine";
import { FxRateService } from "../services/fxRateService";
import { ConversationMemory } from "../agent/conversationMemory";

export interface ExtractedInvoice {
    vendor: string | null;
    amount: string | null;
    currency: string | null;
    detectedAmount?: string | null;
    detectedCurrency?: string | null;
    settlementAmount?: string | null;
    settlementCurrency?: string | null;
    invoiceNumber: string | null;
    date: string | null;
}

export type InvoiceSessionStatus =
    | "uploaded"
    | "analyzed"
    | "review_required"
    | "ready_to_prepare"
    | "awaiting_override"
    | "awaiting_payment_confirmation"
    | "paid"
    | "cancelled"
    | "closed";

export interface InvoiceSessionRiskState {
    level: RiskResult["level"];
    riskScore: number;
    flags: string[];
    explanations: string[];
    canPreparePayment: boolean;
    requiresOverride: boolean;
    blocked: boolean;
}

export interface InvoiceSessionResolution {
    displayVendor: string;
    matchedVendorName: string | null;
    resolvedBeneficiary: string | null;
    canPreparePayment: boolean;
    requiresOverride: boolean;
}

export interface InvoiceSessionRecord {
    id: string;
    chatId: number;
    status: InvoiceSessionStatus;
    invoice: ExtractedInvoice;
    risk: InvoiceSessionRiskState | null;
    rawRisk: RiskResult | null;
    resolution: InvoiceSessionResolution;
    sourceMessageId: number | null;
    sourceMimeType: string | null;
    openedAt: number;
    updatedAt: number;
    expiresAt: number;
}

export class InvoiceEngine {
    private static readonly SESSION_TTL_MS = 30 * 60 * 1000;
    private riskEngine: RiskEngine;
    private fxRateService: FxRateService;
    /** Prevents concurrent invoice analysis for the same chatId */
    private processingChats: Set<number> = new Set();

    constructor(
        private bot: TelegramBot,
        private invoiceStore: InvoiceStore,
        private vendorStore: VendorStore,
        private conversationMemory?: ConversationMemory,
        private onMessage?: (chatId: number, msg: string) => void
    ) {
        this.riskEngine = new RiskEngine(invoiceStore, vendorStore);
        this.fxRateService = new FxRateService();
    }

    /**
     * Main entry point — analyze a file buffer and return extracted invoice fields.
     */
    async analyzeInvoice(buffer: Buffer, mimeType: string): Promise<ExtractedInvoice> {
        let text: string;

        if (mimeType === "application/pdf") {
            text = await this.extractTextFromPDF(buffer);
        } else {
            text = await this.extractTextFromImage(buffer);
        }

        // Store raw text for risk analysis
        this._lastRawText = text;
        return await this.extractFields(text);
    }

    private _lastRawText = "";

    private async buildSettlementFields(amount: string | null, currency: string | null): Promise<{
        amount: string | null;
        currency: string | null;
        detectedAmount: string | null;
        detectedCurrency: string | null;
        settlementAmount: string | null;
        settlementCurrency: string | null;
    }> {
        const normalizedDetectedCurrency = currency ? currency.toUpperCase() : null;
        const detectedAmount = amount;
        let settlementCurrency: string;
        let settlementAmount: string | null = null;

        if (normalizedDetectedCurrency === "EURC") {
            settlementCurrency = "EURC";
            settlementAmount = detectedAmount;
        } else {
            settlementCurrency = "USDC";
            if (detectedAmount && normalizedDetectedCurrency) {
                try {
                    settlementAmount = await this.fxRateService.convertToUsd(detectedAmount, normalizedDetectedCurrency);
                } catch (error) {
                    console.error("[Invoice] FX conversion failed:", error);
                }
            }
        }

        return {
            amount: settlementAmount,
            currency: settlementCurrency,
            detectedAmount,
            detectedCurrency: normalizedDetectedCurrency,
            settlementAmount,
            settlementCurrency
        };
    }

    private getDetectedAmount(extracted: ExtractedInvoice): string | null {
        return extracted.detectedAmount || extracted.amount;
    }

    private getDetectedCurrency(extracted: ExtractedInvoice): string | null {
        return extracted.detectedCurrency || extracted.currency;
    }

    private getSettlementAmount(extracted: ExtractedInvoice): string | null {
        return extracted.settlementAmount || extracted.amount;
    }

    private getSettlementCurrency(extracted: ExtractedInvoice): string | null {
        return extracted.settlementCurrency || extracted.currency || "USDC";
    }

    private buildInvoiceAmountLines(extracted: ExtractedInvoice): string[] {
        const detectedAmount = this.getDetectedAmount(extracted);
        const detectedCurrency = this.getDetectedCurrency(extracted) || "USD";
        const settlementAmount = this.getSettlementAmount(extracted);
        const settlementCurrency = this.getSettlementCurrency(extracted) || "USDC";

        const lines = [`Detected: **${detectedAmount} ${detectedCurrency}**`];
        if (settlementAmount) {
            lines.push(`Settlement: **${settlementAmount} ${settlementCurrency}**`);
        } else {
            lines.push(`Settlement: **conversion required** (${settlementCurrency})`);
        }

        return lines;
    }

    private resolveInvoiceVendor(chatId: number, extracted: ExtractedInvoice): InvoiceSessionResolution {
        const vendorLabel = extracted.vendor || "Unknown Vendor";

        if (ethers.isAddress(vendorLabel)) {
            return {
                displayVendor: vendorLabel,
                matchedVendorName: null,
                resolvedBeneficiary: vendorLabel,
                canPreparePayment: true,
                requiresOverride: false
            };
        }

        const resolved = extracted.vendor ? this.vendorStore.resolveVendor(chatId, extracted.vendor) : null;
        return {
            displayVendor: vendorLabel,
            matchedVendorName: resolved?.name || null,
            resolvedBeneficiary: resolved?.data.address || null,
            canPreparePayment: Boolean(resolved?.data.address),
            requiresOverride: false
        };
    }

    private buildNextStepLines(
        extracted: ExtractedInvoice,
        risk: InvoiceSessionRiskState | null,
        resolution: InvoiceSessionResolution
    ): string[] {
        const settlementAmount = this.getSettlementAmount(extracted);
        const settlementCurrency = this.getSettlementCurrency(extracted) || "USDC";
        const vendorLabel = extracted.vendor || "this vendor";

        if (!this.getSettlementAmount(extracted)) {
            return [
                "Next step:",
                "• I still need a clean settlement amount before I can line this payment up automatically.",
                "• You can retry later when FX conversion is available, or send the payment manually."
            ];
        }

        if (!resolution.canPreparePayment && extracted.vendor) {
            return [
                "Next step:",
                `• If you want to pay it here, save "${extracted.vendor}" with a wallet address first.`,
                `• Once that vendor is saved, I can use this invoice to line up ${settlementAmount} ${settlementCurrency}.`
            ];
        }

        if (risk?.level === "REVIEW") {
            return [
                "Next step:",
                "• Review the flags below and ask me what looks off if you want details.",
                "• If you still want to continue after reviewing them, tell me to go ahead anyway.",
                `• Once you explicitly override, I'll line up ${settlementAmount} ${settlementCurrency} to ${vendorLabel}.`
            ];
        }

        if (risk?.level === "HIGH_RISK") {
            return [
                "Next step:",
                "• Review the risk flags carefully and ask me what triggered them if you want more detail.",
                "• This invoice is blocked from payment preparation until you upload a safer invoice or resolve the flagged issue."
            ];
        }

        return [
            "Next step:",
            `• If you want, I can line up ${settlementAmount} ${settlementCurrency} to ${vendorLabel} now.`,
            "• You can also ask what I checked, confirm the amount, or leave it for later."
        ];
    }

    private buildRiskExplanationLines(extracted: ExtractedInvoice, risk: InvoiceSessionRiskState | null, canPreparePayment: boolean): string[] {
        if (!risk || risk.flags.length === 0) {
            return [];
        }

        return [
            "",
            "Why this needs attention:",
            ...risk.explanations.map((line) => `• ${line}`),
            "",
            `Recommendation: ${RiskEngine.formatRecommendation({
                level: risk.level,
                flags: risk.flags,
                riskScore: risk.riskScore
            } as RiskResult, { canPreparePayment })}`
        ];
    }

    private buildReadinessLine(extracted: ExtractedInvoice, risk: InvoiceSessionRiskState | null, canPreparePayment: boolean): string {
        if (!this.getSettlementAmount(extracted)) {
            return "Payment readiness: **Waiting for FX conversion**";
        }
        if (!canPreparePayment) {
            return "Payment readiness: **Save the vendor first**";
        }
        if (risk?.level === "HIGH_RISK") {
            return "Payment readiness: **Blocked until you review the risk flags**";
        }
        if (risk?.level === "REVIEW") {
            return "Payment readiness: **Ready after review**";
        }
        return "Payment readiness: **Ready to pay**";
    }

    private getSessionKey(chatId: number): string {
        return chatId.toString();
    }

    private buildInvoiceSessionRiskState(risk: RiskResult | null, resolution: InvoiceSessionResolution): InvoiceSessionRiskState | null {
        if (!risk) {
            return null;
        }

        return {
            level: risk.level,
            riskScore: risk.riskScore,
            flags: risk.flags,
            explanations: RiskEngine.explainFlags(risk),
            canPreparePayment: resolution.canPreparePayment && risk.level === "SAFE",
            requiresOverride: resolution.canPreparePayment && risk.level === "REVIEW",
            blocked: risk.level === "HIGH_RISK"
        };
    }

    private deriveSessionStatus(resolution: InvoiceSessionResolution, risk: InvoiceSessionRiskState | null, extracted: ExtractedInvoice): InvoiceSessionStatus {
        if (!this.getSettlementAmount(extracted) || !resolution.canPreparePayment) {
            return "analyzed";
        }

        if (risk?.level === "HIGH_RISK" || risk?.level === "REVIEW") {
            return "review_required";
        }

        return "ready_to_prepare";
    }

    private upsertSession(
        chatId: number,
        extracted: ExtractedInvoice,
        rawRisk: RiskResult | null,
        metadata?: { sourceMessageId?: number | null; sourceMimeType?: string | null }
    ): InvoiceSessionRecord {
        const now = Date.now();
        const resolution = this.resolveInvoiceVendor(chatId, extracted);
        const risk = this.buildInvoiceSessionRiskState(rawRisk, resolution);
        const session: InvoiceSessionRecord = {
            id: `${chatId}-${randomUUID()}`,
            chatId,
            status: this.deriveSessionStatus(resolution, risk, extracted),
            invoice: extracted,
            risk,
            rawRisk,
            resolution,
            sourceMessageId: metadata?.sourceMessageId ?? null,
            sourceMimeType: metadata?.sourceMimeType ?? null,
            openedAt: now,
            updatedAt: now,
            expiresAt: now + InvoiceEngine.SESSION_TTL_MS
        };

        this._activeInvoiceSessions[this.getSessionKey(chatId)] = session;
        if (this.conversationMemory && (extracted.amount || extracted.vendor)) {
            const riskLevelMap: Record<string, "safe" | "review" | "high_risk"> = {
                "SAFE": "safe",
                "REVIEW": "review",
                "HIGH_RISK": "high_risk"
            };
            this.conversationMemory.setLastInvoice(chatId, {
                vendor: extracted.vendor,
                amount: extracted.amount,
                currency: extracted.currency,
                detectedAmount: extracted.detectedAmount,
                detectedCurrency: extracted.detectedCurrency,
                settlementAmount: extracted.settlementAmount,
                settlementCurrency: extracted.settlementCurrency,
                invoiceNumber: extracted.invoiceNumber,
                riskLevel: rawRisk ? riskLevelMap[rawRisk.level] : undefined,
                riskFlags: rawRisk?.flags
            });
        }
        return session;
    }

    /** Send the invoice summary card directly to the user (bypasses LLM). */
    sendInvoiceSummary(chatId: number, session: InvoiceSessionRecord): void {
        const message = this.buildSessionSummaryMessage(session);
        this.bot.sendMessage(chatId, message, {
            parse_mode: "Markdown",
            ...(this.getInvoiceReplyMarkup(session) ? { reply_markup: this.getInvoiceReplyMarkup(session) } : {})
        });
        this.onMessage?.(chatId, message);
    }

    private getInvoiceReplyMarkup(session: InvoiceSessionRecord): TelegramBot.SendMessageOptions["reply_markup"] | undefined {
        if (session.status !== "ready_to_prepare" || !session.resolution.canPreparePayment) {
            return undefined;
        }

        return {
            inline_keyboard: [[
                { text: "Prepare Payment", callback_data: `invpay_${session.chatId}` },
                { text: "Cancel", callback_data: `invcancel_${session.chatId}` }
            ]]
        };
    }

    private buildSessionSummaryMessage(session: InvoiceSessionRecord): string {
        const { invoice, resolution, risk } = session;
        let message = "📄 Invoice summary\n\n";
        message += `Vendor: **${resolution.displayVendor}**\n`;
        if (resolution.matchedVendorName && !this.vendorNamesEquivalent(resolution.matchedVendorName, resolution.displayVendor)) {
            message += `Matched saved vendor: **${resolution.matchedVendorName}**\n`;
        }
        if (resolution.resolvedBeneficiary) {
            message += `Resolved address: \`${resolution.resolvedBeneficiary}\`\n`;
        }
        message += `${this.buildInvoiceAmountLines(invoice).join("\n")}\n`;
        message += `${this.buildReadinessLine(invoice, risk, resolution.canPreparePayment)}\n`;
        if (invoice.invoiceNumber) message += `Invoice #: ${invoice.invoiceNumber}\n`;
        if (invoice.date) message += `Date: ${invoice.date}\n`;

        if (!this.getSettlementAmount(invoice)) {
            message += "\n⚠️ FX conversion is unavailable right now, so I won't prepare this payment automatically.\n\n";
            message += this.buildNextStepLines(invoice, risk, resolution).join("\n");
            return message;
        }

        if (risk?.level === "HIGH_RISK" || risk?.level === "REVIEW") {
            message += RiskEngine.formatRiskMessage({
                level: risk.level,
                flags: risk.flags,
                riskScore: risk.riskScore
            } as RiskResult);
            const explanationLines = this.buildRiskExplanationLines(invoice, risk, resolution.canPreparePayment);
            if (explanationLines.length) {
                message += `\n${explanationLines.join("\n")}`;
            }
            message += "\n\n";
            message += this.buildNextStepLines(invoice, risk, resolution).join("\n");
            return message;
        }

        message += "\n✅ Risk check passed\n\n";
        message += "You can ask what I checked, ask for the amount again, tell me to line it up, or leave it for later.\n\n";
        message += this.buildNextStepLines(invoice, risk, resolution).join("\n");
        return message;
    }

    private normalizeAmountValue(raw: string): string {
        if (/\d{1,3}\.\d{3}/.test(raw) || /,\d{2}$/.test(raw)) {
            return raw.replace(/\./g, "").replace(",", ".");
        }
        return raw.replace(/,/g, "");
    }

    private sanitizeInvoiceNumber(value: string | null): string | null {
        if (!value) {
            return null;
        }

        const normalized = value.trim().replace(/[.:]+$/, "");
        const lowered = normalized.toLowerCase();
        const blocked = new Set([
            "invoice",
            "fatura",
            "receipt",
            "bill",
            "number",
            "numara",
            "numarası",
            "numarasi",
            "no"
        ]);

        if (blocked.has(lowered) || normalized.length < 3) {
            return null;
        }

        if (!/[0-9]/.test(normalized) && !/[A-Z]/.test(normalized)) {
            return null;
        }

        return normalized;
    }

    private sanitizeVendorCandidate(value: string | null): string | null {
        if (!value) {
            return null;
        }

        const normalized = value
            .trim()
            .replace(/^[\s:.-]+/, "")
            .replace(/[\s:.-]+$/, "")
            .replace(/\s{2,}/g, " ");

        const lowered = normalized.toLowerCase();
        const blocked = new Set([
            "invoice",
            "fatura",
            "receipt",
            "bill",
            "payment",
            "customer",
            "bill to",
            "billed to",
            "invoice summary",
            "payment address",
            "address",
            "unknown vendor",
            "lar",
            "ler"
        ]);

        if (!normalized || normalized.length < 3 || blocked.has(lowered)) {
            return null;
        }

        if (/^[a-zçğıöşü]+$/i.test(normalized) && /^[a-zçğıöşü]+$/.test(normalized) && normalized.length <= 3) {
            return null;
        }

        if (/^[a-zçğıöşü]+$/.test(normalized) && /(lar|ler)$/.test(lowered) && normalized.length <= 5) {
            return null;
        }

        return normalized;
    }

    private vendorNamesEquivalent(a: string | null, b: string | null): boolean {
        const normalize = (value: string | null): string => (value || "")
            .toLowerCase()
            .trim();

        return Boolean(a && b) && normalize(a) === normalize(b);
    }

    private inferDefaultCurrency(text: string): string {
        const upperText = text.toUpperCase();

        if (/\bUSDC\b/i.test(text)) return "USDC";
        if (/\bEURC\b/i.test(text)) return "EURC";
        if (/\bUSD\b/i.test(text) || /\$/.test(text) || /\bPAID ON\b/i.test(upperText)) return "USD";
        if (/\bEUR\b/i.test(text) || /€/.test(text)) return "EUR";
        if (/\bTRY\b/i.test(text) || /\bTL\b/i.test(text) || /₺/.test(text)) return "TRY";
        return "USD";
    }

    private collectNonEmptyLines(text: string): string[] {
        return text
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);
    }

    private normalizeExtractedText(text: string): string {
        const cleaned = text
            .replace(/-\r?\n(?=\w)/g, "")
            .replace(/[ \t]+/g, " ");
        const rawLines = cleaned.split(/\r?\n/);
        const merged: string[] = [];

        for (const rawLine of rawLines) {
            const line = rawLine.trim();
            if (!line) {
                continue;
            }

            const previous = merged[merged.length - 1];
            const isShortAlphaFragment = /^[A-Za-zÇçĞğİıÖöŞşÜü]{1,3}$/.test(line);
            const previousLooksWordLike = Boolean(previous) && /[A-Za-zÇçĞğİıÖöŞşÜü]$/.test(previous);

            if (isShortAlphaFragment && previousLooksWordLike && !/[.:]$/.test(previous)) {
                merged[merged.length - 1] = `${previous}${line}`;
                continue;
            }

            merged.push(line);
        }

        return merged.join("\n");
    }

    private extractInvoiceNumberCandidate(text: string): string | null {
        const lines = this.collectNonEmptyLines(text);
        const candidates: Array<{ value: string; score: number }> = [];
        const pushCandidate = (raw: string | null | undefined, score: number) => {
            const sanitized = this.sanitizeInvoiceNumber(raw || null);
            if (!sanitized) {
                return;
            }
            candidates.push({ value: sanitized, score });
        };

        const patterns: Array<{ regex: RegExp; score: number }> = [
            { regex: /invoice\s*(?:#|no\.?|number|num)?\s*:?\s*([A-Z0-9][\w-]{2,30})/i, score: 12 },
            { regex: /fatura\s*(?:no\.?|numarası|numarasi)?\s*:?\s*([A-Z0-9][\w-]{2,30})/i, score: 12 },
            { regex: /(?:inv|ref|reference)\s*(?:#|no\.?)?\s*:?\s*([A-Z0-9][\w-]{2,30})/i, score: 10 },
            { regex: /#\s*([A-Z0-9][\w-]{3,30})/i, score: 6 }
        ];

        for (const line of lines) {
            for (const pattern of patterns) {
                const match = line.match(pattern.regex);
                if (match) {
                    pushCandidate(match[1], pattern.score);
                }
            }
        }

        if (candidates.length === 0) {
            return null;
        }

        candidates.sort((a, b) => b.score - a.score || b.value.length - a.value.length);
        return candidates[0].value;
    }

    private extractDateCandidate(text: string): string | null {
        const trMonths = "Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık";
        const enMonths = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";
        const lines = this.collectNonEmptyLines(text);
        const candidates: Array<{ value: string; score: number }> = [];
        const patterns: Array<{ regex: RegExp; score: number }> = [
            { regex: new RegExp(`(?:tarih|date\\s*paid|date|issued|created|düzenleme\\s*tarihi|fatura\\s*tarihi|son\\s*ödeme\\s*tarihi)[:\\s]*(\\d{1,2}[\\s.]+(?:${trMonths}|${enMonths})[a-zıüğşçö]*\\s+\\d{4})`, "i"), score: 12 },
            { regex: new RegExp(`(?:tarih|date\\s*paid|date|issued|created)[:\\s]*((?:${enMonths}|${trMonths})[a-zıüğşçö]*\\s+\\d{1,2},?\\s+\\d{4})`, "i"), score: 12 },
            { regex: /(?:tarih|date|issued|created|düzenleme|son\s*ödeme)[:\s]*([\d]{1,2}[.\/\-][\d]{1,2}[.\/\-][\d]{2,4})/i, score: 10 },
            { regex: /(?:date|issued|created|due\s*date)[:\s]*([\d]{1,2}[\/\-][\d]{1,2}[\/\-][\d]{2,4})/i, score: 10 },
            { regex: new RegExp(`paid\\s+on\\s+((?:${enMonths})[a-z]*\\s+\\d{1,2},?\\s+\\d{4})`, "i"), score: 8 },
            { regex: new RegExp(`(\\d{1,2}\\s+(?:${trMonths}|${enMonths})[a-zıüğşçö]*\\s+\\d{4})`, "i"), score: 6 },
            { regex: new RegExp(`((?:${enMonths}|${trMonths})[a-zıüğşçö]*\\s+\\d{1,2},?\\s+\\d{4})`, "i"), score: 6 },
            { regex: /([\d]{1,2}\.[\d]{1,2}\.[\d]{4})/, score: 5 }
        ];

        for (const line of lines) {
            for (const pattern of patterns) {
                const match = line.match(pattern.regex);
                if (match) {
                    candidates.push({ value: match[1], score: pattern.score });
                }
            }
        }

        if (candidates.length === 0) {
            return null;
        }

        candidates.sort((a, b) => b.score - a.score || b.value.length - a.value.length);
        return candidates[0].value;
    }

    private extractVendorCandidate(text: string): string | null {
        const lines = this.collectNonEmptyLines(text);
        const candidates: Array<{ vendor: string; score: number }> = [];
        const pushCandidate = (raw: string | null | undefined, score: number) => {
            const sanitized = this.sanitizeVendorCandidate(raw || null);
            if (!sanitized) {
                return;
            }
            candidates.push({ vendor: sanitized, score });
        };

        const explicitPatterns: Array<{ regex: RegExp; score: number }> = [
            { regex: /(?:from|vendor|company|billed?\s*by|seller|supplier|merchant|issued\s*by)[:\s]*([A-Za-zÇçĞğİıÖöŞşÜü][A-Za-zÇçĞğİıÖöŞşÜü0-9 &.,-]{2,50})/i, score: 12 },
            { regex: /(?:firma|şirket|gönderen|hizmet\s*sağlayıcı|servis\s*sağlayıcı|kurum)[:\s]*([A-Za-zÇçĞğİıÖöŞşÜü][A-Za-zÇçĞğİıÖöŞşÜü0-9 &.,-]{2,50})/i, score: 12 },
            { regex: /(?:payable\s*to|remit\s*to|pay\s*to\s*the\s*order\s*of)[:\s]*([A-Za-z][A-Za-z0-9 &.,-]{2,50})/i, score: 11 },
            { regex: /(?:support|info|destek|iletisim)@([A-Za-z0-9-]+)\./i, score: 6 }
        ];

        for (const line of lines) {
            for (const pattern of explicitPatterns) {
                const match = line.match(pattern.regex);
                if (match) {
                    const value = pattern.regex.source.includes("@")
                        ? match[1].charAt(0).toUpperCase() + match[1].slice(1)
                        : match[1];
                    pushCandidate(value, pattern.score);
                }
            }

            const legalEntityMatch = line.match(/([A-Za-zÇçĞğİıÖöŞşÜü][A-Za-zÇçĞğİıÖöŞşÜü0-9 &.,-]+(?:,\s*)?(?:PBC|Inc\.?|LLC|Corp\.?|Ltd\.?|Co\.?|GmbH|A\.?Ş\.?|Ş\.?T\.?İ\.?))/);
            if (legalEntityMatch) {
                pushCandidate(legalEntityMatch[1], 10);
            }

            const knownCompanyMatch = line.match(/(Turkcell|Vodafone|Türk\s*Telekom|TEDAŞ|BEDAŞ|İGDAŞ|İSKİ|EÜAŞ|Enerjisa)/i);
            if (knownCompanyMatch) {
                pushCandidate(knownCompanyMatch[1], 10);
            }
        }

        for (const line of lines.slice(0, 6)) {
            const looksLikeTitle = /^[A-ZÇĞİÖŞÜ][A-Za-zÇçĞğİıÖöŞşÜü0-9&.,'’ -]{2,50}$/.test(line)
                && /[A-Za-zÇçĞğİıÖöŞşÜü]/.test(line)
                && !/(invoice|receipt|bill|date|total|amount|payment|fatura|tarih|due|balance|summary)/i.test(line);

            if (looksLikeTitle) {
                const bonus = /\s/.test(line) ? 7 : 4;
                pushCandidate(line, bonus);
            }
        }

        if (candidates.length === 0) {
            return null;
        }

        candidates.sort((a, b) => b.score - a.score || b.vendor.length - a.vendor.length);
        return candidates[0].vendor;
    }

    private extractAmountCandidate(text: string): { amount: string; currency: string } | null {
        const lines = this.collectNonEmptyLines(text);

        const candidates: Array<{ amount: string; currency: string; score: number }> = [];

        const keywordScore = (line: string): number => {
            let score = 0;
            if (/(amount\s*paid|total\s*paid|net\s*paid|grand\s*total|invoice\s*total|payment\s*due)/i.test(line)) score += 8;
            if (/(total|balance|due|amount|paid\s+on)/i.test(line)) score += 5;
            if (/(ödenecek\s*tutar|toplam\s*borç|toplam\s*tutar|son\s*ödeme\s*tutarı|bakiye)/i.test(line)) score += 5;
            return score;
        };

        const pushCandidate = (rawAmount: string, currency: string | null, line: string, bonus: number = 0) => {
            const normalizedCurrency = (currency || this.inferDefaultCurrency(line)).toUpperCase();
            const finalCurrency = normalizedCurrency === "TL" || normalizedCurrency === "₺" ? "TRY" : normalizedCurrency;
            candidates.push({
                amount: this.normalizeAmountValue(rawAmount),
                currency: finalCurrency,
                score: keywordScore(line) + bonus
            });
        };

        for (const line of lines) {
            const symbolFirstPatterns: Array<{ regex: RegExp; currency: string; bonus: number }> = [
                { regex: /\$\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)/i, currency: "USD", bonus: 8 },
                { regex: /€\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)/i, currency: "EUR", bonus: 8 },
                { regex: /₺\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)/i, currency: "TRY", bonus: 8 }
            ];

            for (const pattern of symbolFirstPatterns) {
                const match = line.match(pattern.regex);
                if (match) {
                    pushCandidate(match[1], pattern.currency, line, pattern.bonus);
                }
            }

            const explicitCurrencyPattern = /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)\s*(USDC|USD|EURC|EUR|TRY|TL)\b/i;
            const explicitCurrencyMatch = line.match(explicitCurrencyPattern);
            if (explicitCurrencyMatch) {
                pushCandidate(explicitCurrencyMatch[1], explicitCurrencyMatch[2], line, 7);
            }

            const genericKeywordPattern = /(?:amount\s*paid|total\s*paid|net\s*paid|grand\s*total|invoice\s*total|payment\s*due|total|balance|due|amount|ödenecek\s*tutar|toplam\s*borç|toplam\s*tutar|son\s*ödeme\s*tutarı|bakiye)[:\s]*[$€₺]?\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)/i;
            const genericKeywordMatch = line.match(genericKeywordPattern);
            if (genericKeywordMatch) {
                pushCandidate(genericKeywordMatch[1], null, line, 4);
            }
        }

        if (candidates.length === 0) {
            return null;
        }

        candidates.sort((a, b) => b.score - a.score);
        return {
            amount: candidates[0].amount,
            currency: candidates[0].currency
        };
    }

    /**
     * Step 2a — Extract text from PDF using pdf-parse.
     * OCR fallback is intentionally skipped for PDFs: tesseract.js cannot
     * process PDF buffers and throws an uncaught Worker error that kills the process.
     */
    async extractTextFromPDF(buffer: Buffer): Promise<string> {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { PDFParse } = require("pdf-parse") as { PDFParse: new (opts: { data: Buffer }) => { getText(): Promise<{ text: string }> } };
            const parser = new PDFParse({ data: buffer });
            const result = await parser.getText();
            const text = result.text || "";
            console.log(`[Invoice] PDF extracted ${text.trim().length} chars — preview: ${JSON.stringify(text.substring(0, 300))}`);

            if (text.trim().length > 0) {
                return text;
            }

            console.log("[Invoice] PDF yielded no text — likely a scanned/image PDF.");
        } catch (err: any) {
            console.log(`[Invoice] PDF parse failed: ${err.message}`);
        }

        // Scanned/image PDFs cannot be OCR'd directly from the PDF buffer.
        // Return empty string — processInvoiceSilent handles the missing-data case.
        return "";
    }

    /**
     * Step 2b — Extract text from image using tesseract.js OCR (EN + TR)
     */
    async extractTextFromImage(buffer: Buffer): Promise<string> {
        const Tesseract = await import("tesseract.js");
        const recognize = (Tesseract as any).default?.recognize || Tesseract.recognize;
        const result = await recognize(buffer, "eng+tur");
        return result.data.text;
    }

    /**
     * Step 3 — Extract structured fields from raw text using regex
     */
    async extractFields(text: string): Promise<ExtractedInvoice> {
        const normalizedText = this.normalizeExtractedText(text);

        // Amount + Currency
        let amount: string | null = null;
        let currency: string | null = null;
        const amountCandidate = this.extractAmountCandidate(normalizedText);
        if (amountCandidate) {
            amount = amountCandidate.amount;
            currency = amountCandidate.currency;
        }

        const invoiceNumber = this.extractInvoiceNumberCandidate(normalizedText);
        const date = this.extractDateCandidate(normalizedText);

        // Vendor name — EN + TR
        // NOTE: "Bill to" / "Fatura adresi" is the CUSTOMER, not the vendor!
        const vendor = this.extractVendorCandidate(normalizedText);

        return {
            vendor,
            invoiceNumber,
            date,
            ...(await this.buildSettlementFields(amount, currency))
        };
    }

    /**
     * Step 4-7 — Process invoice with risk analysis
     */
    async processInvoice(
        chatId: number,
        extracted: ExtractedInvoice,
        metadata?: { sourceMessageId?: number | null; sourceMimeType?: string | null }
    ): Promise<InvoiceSessionRecord | null> {
        const detectedAmount = this.getDetectedAmount(extracted);

        if (!detectedAmount && !extracted.vendor) {
            const errMsg = "❌ I couldn't extract payment details from this document.\n\n" +
                "Make sure the invoice contains:\n" +
                "• A total/amount (e.g. \"Total: $50.00 USDC\")\n" +
                "• A vendor/company name\n\n" +
                "You can also manually create a payment:\n" +
                "`send 50 usdc jack`";
            this.bot.sendMessage(chatId, errMsg, { parse_mode: "Markdown" });
            this.onMessage?.(chatId, errMsg);
            return null;
        }

        if (!extracted.vendor) {
            extracted.vendor = "Unknown Vendor";
        }
        if (!detectedAmount) {
            const errMsg = `📄 Found vendor: *${extracted.vendor}*\n\n` +
                "But I couldn't detect the amount. " +
                "Please send the payment manually:\n" +
                "`send <amount> usdc <recipient>`";
            this.bot.sendMessage(chatId, errMsg, { parse_mode: "Markdown" });
            this.onMessage?.(chatId, errMsg);
            return null;
        }

        const rawRisk = this.getSettlementAmount(extracted)
            ? this.riskEngine.analyzeInvoiceRisk(chatId, extracted, this._lastRawText)
            : null;
        if (rawRisk) {
            console.log(`[Risk] chatId=${chatId} score=${rawRisk.riskScore.toFixed(2)} level=${rawRisk.level} flags=[${rawRisk.flags.join(",")}]`);
        }

        const session = this.upsertSession(chatId, extracted, rawRisk, metadata);
        const message = this.buildSessionSummaryMessage(session);
        this.bot.sendMessage(chatId, message, {
            parse_mode: "Markdown",
            ...(this.getInvoiceReplyMarkup(session) ? { reply_markup: this.getInvoiceReplyMarkup(session) } : {})
        });
        this.onMessage?.(chatId, message);
        return session;
    }

    /**
     * Silent version of processInvoice — runs extraction, risk scoring, stores the session
     * in memory, but does NOT send any Telegram message. Returns the session or an error string.
     * Use this when the caller (e.g. Orchestrator) wants to handle the response naturally.
     */
    async processInvoiceSilent(
        chatId: number,
        extracted: ExtractedInvoice,
        metadata?: { sourceMessageId?: number | null; sourceMimeType?: string | null }
    ): Promise<{ session: InvoiceSessionRecord; error: null } | { session: null; error: string }> {
        if (this.processingChats.has(chatId)) {
            return { session: null, error: "An invoice is already being processed. Please wait." };
        }
        this.processingChats.add(chatId);
        try {
            return await this._processInvoiceSilentInner(chatId, extracted, metadata);
        } finally {
            this.processingChats.delete(chatId);
        }
    }

    private async _processInvoiceSilentInner(
        chatId: number,
        extracted: ExtractedInvoice,
        metadata?: { sourceMessageId?: number | null; sourceMimeType?: string | null }
    ): Promise<{ session: InvoiceSessionRecord; error: null } | { session: null; error: string }> {
        const detectedAmount = this.getDetectedAmount(extracted);

        if (!detectedAmount && !extracted.vendor) {
            return { session: null, error: "Could not extract vendor or amount from the document." };
        }

        if (!extracted.vendor) {
            extracted.vendor = "Unknown Vendor";
        }

        const rawRisk = this.getSettlementAmount(extracted)
            ? this.riskEngine.analyzeInvoiceRisk(chatId, extracted, this._lastRawText)
            : null;

        if (rawRisk) {
            console.log(`[Risk] chatId=${chatId} score=${rawRisk.riskScore.toFixed(2)} level=${rawRisk.level} flags=[${rawRisk.flags.join(",")}]`);
        }

        const session = this.upsertSession(chatId, extracted, rawRisk, metadata);
        return { session, error: null };
    }

    private _activeInvoiceSessions: Record<string, InvoiceSessionRecord> = {};

    private refreshSession(session: InvoiceSessionRecord): InvoiceSessionRecord {
        const nextResolution = this.resolveInvoiceVendor(session.chatId, session.invoice);
        const nextRisk = this.buildInvoiceSessionRiskState(session.rawRisk, nextResolution);
        const derivedStatus = this.deriveSessionStatus(nextResolution, nextRisk, session.invoice);

        session.resolution = nextResolution;
        session.risk = nextRisk;

        if (session.status !== "awaiting_payment_confirmation"
            && session.status !== "awaiting_override"
            && session.status !== "paid"
            && session.status !== "cancelled"
            && session.status !== "closed") {
            session.status = derivedStatus;
        }

        session.updatedAt = Date.now();
        session.expiresAt = session.updatedAt + InvoiceEngine.SESSION_TTL_MS;
        return session;
    }

    getActiveSession(chatId: number): InvoiceSessionRecord | null {
        const session = this._activeInvoiceSessions[this.getSessionKey(chatId)];
        if (!session) {
            return null;
        }

        if (session.expiresAt <= Date.now()) {
            delete this._activeInvoiceSessions[this.getSessionKey(chatId)];
            return null;
        }

        return this.refreshSession(session);
    }

    markSessionAwaitingOverride(chatId: number, sessionId?: string): InvoiceSessionRecord | null {
        const session = this.getActiveSession(chatId);
        if (!session || (sessionId && session.id !== sessionId)) {
            return null;
        }

        if (session.status === "review_required") {
            session.status = "awaiting_override";
            session.updatedAt = Date.now();
            session.expiresAt = session.updatedAt + InvoiceEngine.SESSION_TTL_MS;
        }
        return session;
    }

    markSessionAwaitingPaymentConfirmation(chatId: number, sessionId?: string): InvoiceSessionRecord | null {
        const session = this.getActiveSession(chatId);
        if (!session || (sessionId && session.id !== sessionId)) {
            return null;
        }

        session.status = "awaiting_payment_confirmation";
        session.updatedAt = Date.now();
        session.expiresAt = session.updatedAt + InvoiceEngine.SESSION_TTL_MS;
        return session;
    }

    restoreSessionAfterPaymentInterruption(chatId: number, sessionId?: string): InvoiceSessionRecord | null {
        const session = this.getActiveSession(chatId);
        if (!session || (sessionId && session.id !== sessionId)) {
            return null;
        }

        session.status = this.deriveSessionStatus(session.resolution, session.risk, session.invoice);
        session.updatedAt = Date.now();
        session.expiresAt = session.updatedAt + InvoiceEngine.SESSION_TTL_MS;
        return session;
    }

    closeSession(chatId: number, status: Extract<InvoiceSessionStatus, "paid" | "cancelled" | "closed"> = "closed", sessionId?: string): void {
        const session = this.getActiveSession(chatId);
        if (!session || (sessionId && session.id !== sessionId)) {
            return;
        }

        session.status = status;
        session.updatedAt = Date.now();
        delete this._activeInvoiceSessions[this.getSessionKey(chatId)];
    }

    markSessionPaid(chatId: number, sessionId?: string): void {
        this.closeSession(chatId, "paid", sessionId);
    }

    getPendingInvoice(chatId: number): ExtractedInvoice | null {
        return this.getActiveSession(chatId)?.invoice || null;
    }

    getPendingRisk(chatId: number): RiskResult | null {
        return this.getActiveSession(chatId)?.rawRisk || null;
    }

    clearPendingInvoice(chatId: number): void {
        this.closeSession(chatId);
    }

    /**
     * Step 7 — Store the invoice
     */
    storeInvoice(chatId: number, extracted: ExtractedInvoice): string {
        const settlementAmount = this.getSettlementAmount(extracted);

        return this.invoiceStore.saveInvoice(chatId, {
            vendor: extracted.vendor || "Unknown",
            amount: settlementAmount || "0",
            currency: this.getSettlementCurrency(extracted) || "USDC",
            detectedAmount: this.getDetectedAmount(extracted),
            detectedCurrency: this.getDetectedCurrency(extracted),
            settlementAmount,
            settlementCurrency: this.getSettlementCurrency(extracted),
            invoiceNumber: extracted.invoiceNumber,
            date: extracted.date,
        });
    }
}
