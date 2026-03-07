import TelegramBot from "node-telegram-bot-api";
import { InvoiceStore } from "../storage/invoiceStore";
import { VendorStore } from "../storage/vendorStore";
import { RiskEngine, RiskResult } from "./riskEngine";
import { MemoryStore } from "../ai/memoryStore";

export interface ExtractedInvoice {
    vendor: string | null;
    amount: string | null;
    currency: string | null;
    invoiceNumber: string | null;
    date: string | null;
}

export class InvoiceEngine {
    private riskEngine: RiskEngine;

    constructor(
        private bot: TelegramBot,
        private invoiceStore: InvoiceStore,
        private vendorStore: VendorStore,
        private memoryStore?: MemoryStore
    ) {
        this.riskEngine = new RiskEngine(invoiceStore, vendorStore);
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
        return this.extractFields(text);
    }

    private _lastRawText = "";

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
    extractFields(text: string): ExtractedInvoice {
        // Amount + Currency
        // Strategy: Find ALL potential amounts, prefer "amount paid"/"ödenecek tutar" > "total"/"toplam" > others
        let amount: string | null = null;
        let currency: string | null = null;

        // Helper: Turkish uses comma as decimal (1.234,56) — normalize to 1234.56
        const normalizeTurkishAmount = (raw: string): string => {
            // If format is 1.234,56 → remove dots, replace comma with dot
            if (/\d{1,3}\.\d{3}/.test(raw) || /,\d{2}$/.test(raw)) {
                return raw.replace(/\./g, "").replace(",", ".");
            }
            return raw.replace(/,/g, "");
        };

        // Highest priority: "Amount paid" / "Ödenecek tutar" / "Toplam borç"
        const paidPatterns = [
            /(?:amount\s*paid|total\s*paid|net\s*paid)[:\s]*\$?\s*(\d{1,3}(?:[,]\d{3})*(?:\.\d{1,2})?)\s*(USDC|USD|EUR|EURC)?/i,
            /\$\s*(\d{1,3}(?:[,]\d{3})*(?:\.\d{1,2})?)\s*paid/i,
            // Turkish: "Ödenecek Tutar" / "Toplam Borç" / "Toplam Tutar"
            /(?:ödenecek\s*tutar|toplam\s*borç|toplam\s*tutar|son\s*ödeme\s*tutarı)[:\s]*[₺]?\s*([\d.,]+)\s*(TL|₺|USDC|USD|EUR)?/i,
        ];

        for (const pattern of paidPatterns) {
            const match = text.match(pattern);
            if (match) {
                amount = normalizeTurkishAmount(match[1]);
                currency = (match[2] || "TRY").toUpperCase();
                if (currency === "₺" || currency === "TL") currency = "TRY";
                break;
            }
        }

        // Second priority: "Total"/"Toplam" (find the LAST one)
        if (!amount) {
            const totalPattern = /(?:total|grand\s*total|toplam|genel\s*toplam)[:\s]*[₺$]?\s*([\d.,]+)\s*(TL|₺|USDC|USD|EUR|EURC|TRY)?/gi;
            let match;
            while ((match = totalPattern.exec(text)) !== null) {
                amount = normalizeTurkishAmount(match[1]);
                currency = (match[2] || "TRY").toUpperCase();
                if (currency === "₺" || currency === "TL") currency = "TRY";
            }
        }

        // Third: "$X.XX paid on" pattern
        if (!amount) {
            const paidOnMatch = text.match(/\$\s*(\d{1,3}(?:[,]\d{3})*(?:\.\d{1,2})?)\s*paid\s*on/i);
            if (paidOnMatch) {
                amount = paidOnMatch[1].replace(/,/g, "");
                currency = "USD";
            }
        }

        // Fourth: Turkish Lira amounts — "₺123,45" or "123,45 TL"
        if (!amount) {
            const tlMatch = text.match(/[₺]\s*([\d.,]+)/i) || text.match(/([\d.,]+)\s*(?:TL|₺)/i);
            if (tlMatch) {
                amount = normalizeTurkishAmount(tlMatch[1]);
                currency = "TRY";
            }
        }

        // Fifth: explicit currency amounts
        if (!amount) {
            const currencyMatch = text.match(/(\d{1,3}(?:[,]\d{3})*(?:\.\d{1,2})?)\s*(USDC|USD|EUR|EURC)/i);
            if (currencyMatch) {
                amount = currencyMatch[1].replace(/,/g, "");
                currency = currencyMatch[2].toUpperCase();
            }
        }

        // Sixth: "Due"/"Borç"/"Balance" amounts
        if (!amount) {
            const dueMatch = text.match(/(?:due|balance|borç|bakiye)[:\s]*[₺$]?\s*([\d.,]+)(?:\s*(USDC|USD|EUR|TL|TRY|₺))?/i);
            if (dueMatch) {
                amount = normalizeTurkishAmount(dueMatch[1]);
                currency = (dueMatch[2] || "TRY").toUpperCase();
                if (currency === "₺" || currency === "TL") currency = "TRY";
            }
        }

        // Last resort: any dollar amount
        if (!amount) {
            const dollarMatch = text.match(/\$\s*(\d{1,3}(?:[,]\d{3})*(?:\.\d{1,2})?)/);
            if (dollarMatch) {
                amount = dollarMatch[1].replace(/,/g, "");
                currency = "USD";
            }
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

        return { vendor, amount, currency: "USDC", invoiceNumber, date };
    }

    /**
     * Step 4-7 — Process invoice with risk analysis
     */
    async processInvoice(chatId: number, extracted: ExtractedInvoice): Promise<void> {
        if (!extracted.amount && !extracted.vendor) {
            this.bot.sendMessage(chatId,
                "❌ Could not extract payment information from this document.\n\n" +
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
        if (!extracted.amount) {
            this.bot.sendMessage(chatId,
                `📄 Found vendor: *${extracted.vendor}*\n\n` +
                "But I couldn't detect the payment amount. " +
                "Please send the payment manually:\n" +
                "`send <amount> usdc <recipient>`", { parse_mode: "Markdown" }
            );
            return;
        }

        const currency = extracted.currency || "USD";

        // ── Risk Analysis ──
        const risk = this.riskEngine.analyzeInvoiceRisk(chatId, extracted, this._lastRawText);
        console.log(`[Risk] chatId=${chatId} score=${risk.riskScore.toFixed(2)} level=${risk.level} flags=[${risk.flags.join(",")}]`);

        // Save pending invoice data in memory for callback
        this._pendingInvoice[chatId.toString()] = extracted;
        this._pendingRisk[chatId.toString()] = risk;

        if (risk.level === "HIGH_RISK") {
            // Block payment — show risk details
            let message = `📄 Invoice detected.\n\n`;
            message += `Vendor: **${extracted.vendor}**\n`;
            message += `Amount: **${extracted.amount} ${currency}**\n`;
            if (extracted.invoiceNumber) message += `Invoice #: ${extracted.invoiceNumber}\n`;
            message += RiskEngine.formatRiskMessage(risk);
            message += `\n\n🚫 Payment blocked due to high risk.`;

            this.bot.sendMessage(chatId, message, {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "⚠️ Override & Pay", callback_data: `invpay_${chatId}` },
                            { text: "Cancel", callback_data: `invcancel_${chatId}` }
                        ]
                    ]
                }
            });
            return;
        }

        if (risk.level === "REVIEW") {
            // Show warning but allow payment
            let vendorResolved = "";
            if (extracted.vendor) {
                const addr = this.vendorStore.getVendor(chatId, extracted.vendor);
                if (addr) vendorResolved = `\n→ Resolved: \`${addr}\``;
            }

            let message = `📄 Invoice detected.\n\n`;
            message += `Vendor: **${extracted.vendor}**${vendorResolved}\n`;
            message += `Amount: **${extracted.amount} ${currency}**\n`;
            if (extracted.invoiceNumber) message += `Invoice #: ${extracted.invoiceNumber}\n`;
            if (extracted.date) message += `Date: ${extracted.date}\n`;
            message += RiskEngine.formatRiskMessage(risk);

            this.bot.sendMessage(chatId, message, {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "Prepare Payment", callback_data: `invpay_${chatId}` },
                            { text: "Cancel", callback_data: `invcancel_${chatId}` }
                        ]
                    ]
                }
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
        const currency = extracted.currency || "USD";
        let vendorResolved = "";

        if (extracted.vendor) {
            const addr = this.vendorStore.getVendor(chatId, extracted.vendor);
            if (addr) {
                vendorResolved = `\n→ Resolved: \`${addr}\``;
            }
        }

        this._pendingInvoice[chatId.toString()] = extracted;

        let message = `📄 Invoice detected.\n\n`;
        message += `Vendor: **${extracted.vendor}**${vendorResolved}\n`;
        message += `Amount: **${extracted.amount} ${currency}**\n`;
        if (extracted.invoiceNumber) message += `Invoice #: ${extracted.invoiceNumber}\n`;
        if (extracted.date) message += `Date: ${extracted.date}\n`;
        message += `\n✅ Risk check passed`;

        this.bot.sendMessage(chatId, message, {
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "Prepare Payment", callback_data: `invpay_${chatId}` },
                        { text: "Cancel", callback_data: `invcancel_${chatId}` }
                    ]
                ]
            }
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
        if (this.memoryStore && extracted.vendor && extracted.amount) {
            this.memoryStore.recordInvoice(chatId, extracted.vendor, parseFloat(extracted.amount));
        }

        return this.invoiceStore.saveInvoice(chatId, {
            vendor: extracted.vendor || "Unknown",
            amount: extracted.amount || "0",
            currency: extracted.currency || "USD",
            invoiceNumber: extracted.invoiceNumber,
            date: extracted.date,
        });
    }
}
