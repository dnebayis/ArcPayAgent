import TelegramBot from "node-telegram-bot-api";
import { ethers } from "ethers";
import { InvoiceStore } from "../storage/invoiceStore";
import { VendorStore } from "../storage/vendorStore";
import { RiskEngine, RiskResult } from "./riskEngine";
import { MemoryStore } from "../ai/memoryStore";
import { FxRateService } from "../services/fxRateService";

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

export class InvoiceEngine {
    private riskEngine: RiskEngine;
    private fxRateService: FxRateService;

    constructor(
        private bot: TelegramBot,
        private invoiceStore: InvoiceStore,
        private vendorStore: VendorStore,
        private memoryStore?: MemoryStore
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
        const settlementCurrency = "USDC";
        let settlementAmount: string | null = null;

        if (detectedAmount && normalizedDetectedCurrency) {
            try {
                settlementAmount = await this.fxRateService.convertToUsd(detectedAmount, normalizedDetectedCurrency);
            } catch (error) {
                console.error("[Invoice] FX conversion failed:", error);
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

    private resolveInvoiceVendor(chatId: number, extracted: ExtractedInvoice): { label: string; resolvedAddress: string | null; canPreparePayment: boolean } {
        const vendorLabel = extracted.vendor || "Unknown Vendor";

        if (ethers.isAddress(vendorLabel)) {
            return {
                label: vendorLabel,
                resolvedAddress: vendorLabel,
                canPreparePayment: true
            };
        }

        const resolvedAddress = extracted.vendor ? this.vendorStore.getVendor(chatId, extracted.vendor) : null;
        return {
            label: vendorLabel,
            resolvedAddress: resolvedAddress || null,
            canPreparePayment: Boolean(resolvedAddress)
        };
    }

    private buildNextStepLines(chatId: number, extracted: ExtractedInvoice, risk: RiskResult | null, canPreparePayment: boolean): string[] {
        if (!this.getSettlementAmount(extracted)) {
            return [
                "Next step:",
                "• Retry later when FX conversion is available, or send the payment manually."
            ];
        }

        if (!canPreparePayment && extracted.vendor) {
            return [
                "Next step:",
                `• Save this vendor first, then ask me to prepare the payment.`,
                `• Example: save vendor "${extracted.vendor}" 0x...`
            ];
        }

        if (risk?.level === "REVIEW") {
            return [
                "Next step:",
                "• Review the flags below, then prepare the payment if everything looks right."
            ];
        }

        if (risk?.level === "HIGH_RISK") {
            return [
                "Next step:",
                "• Review the risk flags carefully before overriding this payment."
            ];
        }

        return [
            "Next step:",
            "• Prepare the payment if the invoice details look correct."
        ];
    }

    private buildReadinessLine(extracted: ExtractedInvoice, risk: RiskResult | null, canPreparePayment: boolean): string {
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
            return "Payment readiness: **Review recommended before payment**";
        }
        return "Payment readiness: **Ready to prepare**";
    }

    private normalizeAmountValue(raw: string): string {
        if (/\d{1,3}\.\d{3}/.test(raw) || /,\d{2}$/.test(raw)) {
            return raw.replace(/\./g, "").replace(",", ".");
        }
        return raw.replace(/,/g, "");
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

    private extractAmountCandidate(text: string): { amount: string; currency: string } | null {
        const lines = text
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);

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
     * Step 2a — Extract text from PDF using pdf-parse, with OCR fallback
     */
    async extractTextFromPDF(buffer: Buffer): Promise<string> {
        try {
            const { PDFParse } = await import("pdf-parse");
            const parser = new PDFParse({ data: buffer });
            const result = await parser.getText();
            const text = (result as any).text || "";
            console.log(`[Invoice] PDF text extracted: ${text.length} chars`);

            // If we got meaningful text, use it
            if (text.trim().length > 20) {
                console.log(`[Invoice] PDF text preview: ${text.substring(0, 200)}`);
                return text;
            }

            // PDF might be scanned/image-based — fall back to OCR
            console.log("[Invoice] PDF text too short, falling back to OCR...");
        } catch (err: any) {
            console.log(`[Invoice] PDF parse failed: ${err.message}, falling back to OCR...`);
        }

        // Fallback: try OCR on the raw buffer (works for some image-embedded PDFs)
        try {
            return await this.extractTextFromImage(buffer);
        } catch {
            return "";
        }
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
        // Amount + Currency
        let amount: string | null = null;
        let currency: string | null = null;
        const amountCandidate = this.extractAmountCandidate(text);
        if (amountCandidate) {
            amount = amountCandidate.amount;
            currency = amountCandidate.currency;
        }

        // Invoice number — EN + TR
        const invoiceNumPatterns = [
            /invoice\s*(?:#|no\.?|number|num)?\s*:?\s*([A-Z0-9][\w-]{2,30})/i,
            // Turkish: "Fatura No" / "Fatura Numarası"
            /fatura\s*(?:no\.?|numarası|numarasi)?\s*:?\s*([A-Z0-9][\w-]{2,30})/i,
            /(?:inv|ref|reference)\s*(?:#|no\.?)?\s*:?\s*([A-Z0-9][\w-]{2,30})/i,
            /#\s*([A-Z0-9][\w-]{3,30})/i
        ];

        let invoiceNumber: string | null = null;
        for (const pattern of invoiceNumPatterns) {
            const match = text.match(pattern);
            if (match) {
                invoiceNumber = match[1];
                break;
            }
        }

        // Date — EN + TR formats
        const trMonths = "Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık";
        const enMonths = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";
        const datePatterns = [
            // "Date paid: January 22, 2026" / "Tarih: 22 Ocak 2026"
            new RegExp(`(?:tarih|date\\s*paid|date|issued|created|düzenleme\\s*tarihi|fatura\\s*tarihi|son\\s*ödeme\\s*tarihi)[:\\s]*(\\d{1,2}[\\s.]+(?:${trMonths}|${enMonths})[a-zıüğşçö]*\\s+\\d{4})`, "i"),
            new RegExp(`(?:tarih|date\\s*paid|date|issued|created)[:\\s]*((?:${enMonths}|${trMonths})[a-zıüğşçö]*\\s+\\d{1,2},?\\s+\\d{4})`, "i"),
            // DD/MM/YYYY or DD.MM.YYYY (Turkish common format)
            /(?:tarih|date|issued|created|düzenleme|son\s*ödeme)[:\s]*([\d]{1,2}[.\/\-][\d]{1,2}[.\/\-][\d]{2,4})/i,
            /(?:date|issued|created|due\s*date)[:\s]*([\d]{1,2}[\/\-][\d]{1,2}[\/\-][\d]{2,4})/i,
            // "$10.00 paid on January 22, 2026"
            new RegExp(`paid\\s+on\\s+((?:${enMonths})[a-z]*\\s+\\d{1,2},?\\s+\\d{4})`, "i"),
            // Standalone dates
            new RegExp(`(\\d{1,2}\\s+(?:${trMonths}|${enMonths})[a-zıüğşçö]*\\s+\\d{4})`, "i"),
            new RegExp(`((?:${enMonths}|${trMonths})[a-zıüğşçö]*\\s+\\d{1,2},?\\s+\\d{4})`, "i"),
            // DD.MM.YYYY standalone
            /([\d]{1,2}\.[\d]{1,2}\.[\d]{4})/,
        ];

        let date: string | null = null;
        for (const pattern of datePatterns) {
            const match = text.match(pattern);
            if (match) {
                date = match[1];
                break;
            }
        }

        // Vendor name — EN + TR
        // NOTE: "Bill to" / "Fatura adresi" is the CUSTOMER, not the vendor!
        const vendorPatterns = [
            // EN explicit
            /(?:from|vendor|company|billed?\s*by|seller|supplier|merchant|issued\s*by)[:\s]*([A-Za-zÇçĞğİıÖöŞşÜü][A-Za-zÇçĞğİıÖöŞşÜü0-9 &.,]{2,40})/i,
            // TR explicit: "Firma", "Şirket", "Gönderen", "Hizmet Sağlayıcı"
            /(?:firma|şirket|gönderen|hizmet\s*sağlayıcı|servis\s*sağlayıcı|kurum)[:\s]*([A-Za-zÇçĞğİıÖöŞşÜü][A-Za-zÇçĞğİıÖöŞşÜü0-9 &.,]{2,40})/i,
            // Payable to / Remit to
            /(?:payable\s*to|remit\s*to|pay\s*to\s*the\s*order\s*of)[:\s]*([A-Za-z][A-Za-z0-9 &.,]{2,40})/i,
            // Company name after "PAYMENT ADDRESS:" 
            /payment\s*address[:\s]+([A-Za-z][A-Za-z0-9 &.,]{2,40})/i,
            // Turkish telecom/utility companies
            /(Turkcell|Vodafone|Türk\s*Telekom|TEDAŞ|BEDAŞ|İGDAŞ|İSKİ|EÜAŞ|Enerjisa)/i,
            // Legal entity suffixes (EN + TR)
            /([A-Za-zÇçĞğİıÖöŞşÜü][A-Za-zÇçĞğİıÖöŞşÜü0-9 &.,]+(?:,\s*)?(?:PBC|Inc\.?|LLC|Corp\.?|Ltd\.?|Co\.?|GmbH|A\.?Ş\.?|Ş\.?T\.?İ\.?))/,
            // "support@company.com" / "info@company.com"
            /(?:support|info|destek|iletisim)@([A-Za-z0-9-]+)\./i,
        ];

        let vendor: string | null = null;
        for (const pattern of vendorPatterns) {
            const match = text.match(pattern);
            if (match) {
                vendor = match[1].trim();
                // If extracted from email domain, capitalize first letter
                if (pattern.source.includes("@")) {
                    vendor = vendor.charAt(0).toUpperCase() + vendor.slice(1);
                }
                break;
            }
        }

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
    async processInvoice(chatId: number, extracted: ExtractedInvoice): Promise<void> {
        const detectedAmount = this.getDetectedAmount(extracted);
        const detectedCurrency = this.getDetectedCurrency(extracted);

        if (!detectedAmount && !extracted.vendor) {
            this.bot.sendMessage(chatId,
                "❌ I couldn't extract payment details from this document.\n\n" +
                "Make sure the invoice contains:\n" +
                "• A total/amount (e.g. \"Total: $50.00 USDC\")\n" +
                "• A vendor/company name\n\n" +
                "You can also manually create a payment:\n" +
                "`send 50 usdc jack`", { parse_mode: "Markdown" }
            );
            return;
        }

        if (!extracted.vendor) {
            extracted.vendor = "Unknown Vendor";
        }
        if (!detectedAmount) {
            this.bot.sendMessage(chatId,
                `📄 Found vendor: *${extracted.vendor}*\n\n` +
                "But I couldn't detect the amount. " +
                "Please send the payment manually:\n" +
                "`send <amount> usdc <recipient>`", { parse_mode: "Markdown" }
            );
            return;
        }

        if (!this.getSettlementAmount(extracted)) {
            const vendorInfo = this.resolveInvoiceVendor(chatId, extracted);
            let message = `📄 Invoice summary\n\n`;
            message += `Vendor: **${vendorInfo.label}**\n`;
            if (vendorInfo.resolvedAddress) {
                message += `Resolved address: \`${vendorInfo.resolvedAddress}\`\n`;
            }
            message += `${this.buildInvoiceAmountLines(extracted).join("\n")}\n`;
            message += `${this.buildReadinessLine(extracted, null, vendorInfo.canPreparePayment)}\n`;
            if (extracted.invoiceNumber) message += `Invoice #: ${extracted.invoiceNumber}\n`;
            if (extracted.date) message += `Date: ${extracted.date}\n`;
            message += `\n⚠️ FX conversion is unavailable right now, so I won't prepare this payment automatically.\n\n`;
            message += this.buildNextStepLines(chatId, extracted, null, vendorInfo.canPreparePayment).join("\n");

            this.bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
            return;
        }

        // ── Risk Analysis ──
        const risk = this.riskEngine.analyzeInvoiceRisk(chatId, extracted, this._lastRawText);
        console.log(`[Risk] chatId=${chatId} score=${risk.riskScore.toFixed(2)} level=${risk.level} flags=[${risk.flags.join(",")}]`);

        // Save pending invoice data in memory for callback
        this._pendingInvoice[chatId.toString()] = extracted;
        this._pendingRisk[chatId.toString()] = risk;

        if (risk.level === "HIGH_RISK") {
            // Block payment — show risk details
            const vendorInfo = this.resolveInvoiceVendor(chatId, extracted);
            let message = `📄 Invoice summary\n\n`;
            message += `Vendor: **${vendorInfo.label}**\n`;
            if (vendorInfo.resolvedAddress) {
                message += `Resolved address: \`${vendorInfo.resolvedAddress}\`\n`;
            }
            message += `${this.buildInvoiceAmountLines(extracted).join("\n")}\n`;
            message += `${this.buildReadinessLine(extracted, risk, vendorInfo.canPreparePayment)}\n`;
            if (extracted.invoiceNumber) message += `Invoice #: ${extracted.invoiceNumber}\n`;
            if (extracted.date) message += `Date: ${extracted.date}\n`;
            message += RiskEngine.formatRiskMessage(risk);
            message += `\n\n🚫 Payment blocked due to high risk.\n\n`;
            message += this.buildNextStepLines(chatId, extracted, risk, vendorInfo.canPreparePayment).join("\n");

            this.bot.sendMessage(chatId, message, {
                parse_mode: "Markdown",
                ...(vendorInfo.canPreparePayment ? {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: "⚠️ Override & Pay", callback_data: `invpay_${chatId}` },
                                { text: "Cancel", callback_data: `invcancel_${chatId}` }
                            ]
                        ]
                    }
                } : {})
            });
            return;
        }

        if (risk.level === "REVIEW") {
            // Show warning but allow payment
            const vendorInfo = this.resolveInvoiceVendor(chatId, extracted);

            let message = `📄 Invoice summary\n\n`;
            message += `Vendor: **${vendorInfo.label}**\n`;
            if (vendorInfo.resolvedAddress) {
                message += `Resolved address: \`${vendorInfo.resolvedAddress}\`\n`;
            }
            message += `${this.buildInvoiceAmountLines(extracted).join("\n")}\n`;
            message += `${this.buildReadinessLine(extracted, risk, vendorInfo.canPreparePayment)}\n`;
            if (extracted.invoiceNumber) message += `Invoice #: ${extracted.invoiceNumber}\n`;
            if (extracted.date) message += `Date: ${extracted.date}\n`;
            message += RiskEngine.formatRiskMessage(risk);
            message += `\n\n${this.buildNextStepLines(chatId, extracted, risk, vendorInfo.canPreparePayment).join("\n")}`;

            this.bot.sendMessage(chatId, message, {
                parse_mode: "Markdown",
                ...(vendorInfo.canPreparePayment ? {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: "Prepare Payment", callback_data: `invpay_${chatId}` },
                                { text: "Cancel", callback_data: `invcancel_${chatId}` }
                            ]
                        ]
                    }
                } : {})
            });
            return;
        }

        // SAFE — proceed normally
        await this.suggestPayment(chatId, extracted);
    }

    /**
     * Step 5 — Display extraction results and offer payment buttons
     */
    async suggestPayment(chatId: number, extracted: ExtractedInvoice): Promise<void> {
        const vendorInfo = this.resolveInvoiceVendor(chatId, extracted);

        this._pendingInvoice[chatId.toString()] = extracted;

        let message = `📄 Invoice summary\n\n`;
        message += `Vendor: **${vendorInfo.label}**\n`;
        if (vendorInfo.resolvedAddress) {
            message += `Resolved address: \`${vendorInfo.resolvedAddress}\`\n`;
        }
        message += `${this.buildInvoiceAmountLines(extracted).join("\n")}\n`;
        message += `${this.buildReadinessLine(extracted, null, vendorInfo.canPreparePayment)}\n`;
        if (extracted.invoiceNumber) message += `Invoice #: ${extracted.invoiceNumber}\n`;
        if (extracted.date) message += `Date: ${extracted.date}\n`;
        message += `\n✅ Risk check passed\n\n`;
        message += this.buildNextStepLines(chatId, extracted, null, vendorInfo.canPreparePayment).join("\n");

        this.bot.sendMessage(chatId, message, {
            parse_mode: "Markdown",
            ...(vendorInfo.canPreparePayment ? {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "Prepare Payment", callback_data: `invpay_${chatId}` },
                            { text: "Cancel", callback_data: `invcancel_${chatId}` }
                        ]
                    ]
                }
            } : {})
        });
    }

    // Temporary store for pending invoice extractions
    private _pendingInvoice: Record<string, ExtractedInvoice> = {};
    private _pendingRisk: Record<string, RiskResult> = {};

    getPendingInvoice(chatId: number): ExtractedInvoice | null {
        return this._pendingInvoice[chatId.toString()] || null;
    }

    getPendingRisk(chatId: number): RiskResult | null {
        return this._pendingRisk[chatId.toString()] || null;
    }

    clearPendingInvoice(chatId: number): void {
        delete this._pendingInvoice[chatId.toString()];
        delete this._pendingRisk[chatId.toString()];
    }

    /**
     * Step 7 — Store the invoice
     */
    storeInvoice(chatId: number, extracted: ExtractedInvoice): string {
        const settlementAmount = this.getSettlementAmount(extracted);

        if (this.memoryStore && extracted.vendor && settlementAmount) {
            this.memoryStore.recordInvoice(chatId, extracted.vendor, parseFloat(settlementAmount));
        }

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
