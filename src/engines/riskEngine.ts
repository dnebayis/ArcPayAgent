import { InvoiceStore } from "../storage/invoiceStore";
import { VendorStore } from "../storage/vendorStore";
import { ExtractedInvoice } from "./invoiceEngine";

export interface RiskResult {
    riskScore: number;
    flags: string[];
    level: "SAFE" | "REVIEW" | "HIGH_RISK";
}

const SUSPICIOUS_KEYWORDS = [
    "urgent",
    "immediate payment",
    "wire today",
    "payment required immediately",
    "act now",
    "time sensitive",
    "overdue penalty",
    "legal action",
    "account suspended",
    "pay immediately"
];

export class RiskEngine {
    constructor(
        private invoiceStore: InvoiceStore,
        private vendorStore: VendorStore
    ) { }

    /**
     * Main risk analysis — runs all checks and returns composite score
     */
    analyzeInvoiceRisk(
        chatId: number,
        invoice: ExtractedInvoice,
        rawText?: string
    ): RiskResult {
        const flags: string[] = [];
        let riskScore = 0;

        // Check 1: Duplicate invoice
        const dupScore = this.checkDuplicate(chatId, invoice);
        if (dupScore > 0) {
            flags.push("duplicate_invoice");
            riskScore += dupScore;
        }

        // Check 2: Unusual amount
        const amountScore = this.checkUnusualAmount(chatId, invoice);
        if (amountScore > 0) {
            flags.push("unusual_amount");
            riskScore += amountScore;
        }

        // Check 3: Vendor mismatch
        const mismatchScore = this.checkVendorMismatch(chatId, invoice);
        if (mismatchScore > 0) {
            flags.push("vendor_mismatch");
            riskScore += mismatchScore;
        }

        // Check 4: Missing fields
        const missingScore = this.checkMissingFields(invoice);
        if (missingScore > 0) {
            flags.push("missing_fields");
            riskScore += missingScore;
        }

        // Check 5: Suspicious language
        const suspiciousScore = this.checkSuspiciousLanguage(rawText || "");
        if (suspiciousScore > 0) {
            flags.push("suspicious_language");
            riskScore += suspiciousScore;
        }

        // Clamp to 0-1
        riskScore = Math.min(1.0, Math.max(0.0, riskScore));

        // Determine level
        let level: RiskResult["level"];
        if (riskScore < 0.3) {
            level = "SAFE";
        } else if (riskScore < 0.6) {
            level = "REVIEW";
        } else {
            level = "HIGH_RISK";
        }

        return { riskScore, flags, level };
    }

    /**
     * Check 1: Duplicate invoice detection
     */
    private checkDuplicate(chatId: number, invoice: ExtractedInvoice): number {
        if (!invoice.vendor || !invoice.invoiceNumber) return 0;

        const isDup = this.invoiceStore.isDuplicate(
            chatId,
            invoice.vendor,
            invoice.invoiceNumber,
            invoice.amount || "",
            invoice.date || ""
        );

        return isDup ? 0.4 : 0;
    }

    /**
     * Check 2: Amount deviates significantly from vendor average
     */
    private checkUnusualAmount(chatId: number, invoice: ExtractedInvoice): number {
        if (!invoice.vendor || !invoice.amount) return 0;

        const vendorData = this.vendorStore.getVendorData(chatId, invoice.vendor);
        if (!vendorData || vendorData.invoiceCount < 2) return 0; // Not enough history

        const avgPayment = vendorData.totalPaid / vendorData.invoiceCount;
        const invoiceAmount = parseFloat(invoice.amount);

        if (avgPayment === 0) return 0;

        const ratio = invoiceAmount / avgPayment;

        // If amount is 5x+ the average, stronger flag
        if (ratio > 5) return 0.5;
        // If amount is 3x+ the average, flag it
        if (ratio > 3) return 0.3;

        return 0;
    }

    /**
     * Check 3: Invoice vendor exists in address book but address differs
     */
    private checkVendorMismatch(chatId: number, invoice: ExtractedInvoice): number {
        // This check requires the invoice to have a payment address
        // In our system, invoices don't contain blockchain addresses typically
        // But we can check if the vendor name resolves differently
        if (!invoice.vendor) return 0;

        const storedAddress = this.vendorStore.getVendor(chatId, invoice.vendor);
        // If vendor exists in address book, no mismatch (vendor is known)
        // If vendor doesn't exist, slight risk since it's unknown
        if (!storedAddress) {
            return 0.1; // Unknown vendor — minor risk
        }

        return 0;
    }

    /**
     * Check 4: Missing required fields
     */
    private checkMissingFields(invoice: ExtractedInvoice): number {
        const requiredFields = ["vendor", "amount", "invoiceNumber", "date"];
        let missing = 0;

        if (!invoice.vendor) missing++;
        if (!invoice.amount) missing++;
        if (!invoice.invoiceNumber) missing++;
        if (!invoice.date) missing++;

        // 0.05 per missing field
        return missing * 0.05;
    }

    /**
     * Check 5: Suspicious language in invoice text
     */
    private checkSuspiciousLanguage(text: string): number {
        if (!text) return 0;

        const lower = text.toLowerCase();
        let matches = 0;

        for (const keyword of SUSPICIOUS_KEYWORDS) {
            if (lower.includes(keyword)) {
                matches++;
            }
        }

        if (matches === 0) return 0;
        if (matches === 1) return 0.15;
        if (matches === 2) return 0.25;
        return 0.35; // 3+ suspicious phrases
    }

    /**
     * Format risk result for display
     */
    static formatRiskMessage(result: RiskResult): string {
        const flagDescriptions: Record<string, string> = {
            duplicate_invoice: "⚠️ Duplicate invoice number detected",
            unusual_amount: "⚠️ Amount is unusually high for this vendor",
            vendor_mismatch: "⚠️ Unknown vendor — not in your address book",
            missing_fields: "⚠️ Some invoice fields are missing",
            suspicious_language: "⚠️ Suspicious urgency language detected"
        };

        if (result.flags.length === 0) return "";

        let msg = "\n\n";
        if (result.level === "HIGH_RISK") {
            msg += "🚨 **High Risk Invoice**\n\n";
        } else {
            msg += "⚠️ **Review Recommended**\n\n";
        }

        msg += "Flags:\n";
        for (const flag of result.flags) {
            msg += `• ${flagDescriptions[flag] || flag}\n`;
        }

        msg += `\nRisk Score: ${(result.riskScore * 100).toFixed(0)}%`;

        return msg;
    }
}
