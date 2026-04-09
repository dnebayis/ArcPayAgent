import PDFDocument from "pdfkit";
import path from "path";
import { ARC_EXPLORER_URL } from "../constants";

const LOGO_PATH = path.join(__dirname, "../../assets/logo.png");

// Brand colors
const BLUE_DARK  = "#0d2137";
const BLUE_MID   = "#1a4a7a";
const ORANGE     = "#ff6b2b";
const WHITE      = "#ffffff";
const GRAY_LIGHT = "#f4f6f8";
const GRAY_TEXT  = "#6b7280";
const DARK_TEXT  = "#111827";

export interface ReceiptData {
    vendor: string;
    address: string;
    amount: string;
    token: string;
    txHash?: string;
    memo?: string;
    timestamp: number;
}

export function generateReceipt(data: ReceiptData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: "A5", margin: 0 });
        const chunks: Buffer[] = [];
        doc.on("data", (c: Buffer) => chunks.push(c));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        const W = doc.page.width;   // 419.5
        const MARGIN = 36;

        // ── Header background ──────────────────────────────────────────
        doc.rect(0, 0, W, 140).fill(BLUE_DARK);

        // Logo (top-left, small)
        try {
            doc.image(LOGO_PATH, MARGIN, 18, { width: 52 });
        } catch { /* logo missing — skip */ }

        // "ArcPay Agent" title
        doc.fillColor(WHITE).fontSize(18).font("Helvetica-Bold")
            .text("ArcPay Agent", MARGIN + 62, 24);
        doc.fillColor(ORANGE).fontSize(9).font("Helvetica")
            .text("Payment Receipt", MARGIN + 62, 47);

        // Amount pill (centered in header)
        const amountStr = `${data.amount} ${data.token}`;
        doc.fillColor(WHITE).fontSize(28).font("Helvetica-Bold")
            .text(amountStr, 0, 75, { align: "center", width: W });

        // Orange accent bar at bottom of header
        doc.rect(0, 133, W, 4).fill(ORANGE);

        // ── Body ───────────────────────────────────────────────────────
        let y = 150;

        const field = (label: string, value: string, mono = false) => {
            doc.fillColor(GRAY_TEXT).fontSize(8).font("Helvetica")
                .text(label.toUpperCase(), MARGIN, y);
            doc.fillColor(DARK_TEXT).fontSize(9.5)
                .font(mono ? "Courier" : "Helvetica")
                .text(value, MARGIN, y + 12, { width: W - MARGIN * 2 });
            y += 44;
        };

        const divider = () => {
            doc.moveTo(MARGIN, y - 10).lineTo(W - MARGIN, y - 10)
                .strokeColor("#e5e7eb").lineWidth(0.5).stroke();
        };

        // Date
        const date = new Date(data.timestamp);
        const dateStr = date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
        const timeStr = date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
        field("Date", `${dateStr}  ·  ${timeStr}`);
        divider();

        field("To", data.vendor);
        divider();

        field("Address", data.address, true);
        divider();

        if (data.memo) {
            field("Memo", data.memo);
            divider();
        }

        if (data.txHash) {
            field("Transaction hash", data.txHash, true);
            divider();
            field("Explorer", `${ARC_EXPLORER_URL}/tx/${data.txHash}`, true);
            divider();
        }

        // ── Status badge ───────────────────────────────────────────────
        const badgeW = 100;
        const badgeX = (W - badgeW) / 2;
        doc.roundedRect(badgeX, y, badgeW, 22, 11).fill("#d1fae5");
        doc.fillColor("#065f46").fontSize(9).font("Helvetica-Bold")
            .text("COMPLETED", badgeX, y + 6, { align: "center", width: badgeW });
        y += 36;

        // ── Footer ─────────────────────────────────────────────────────
        const footerY = doc.page.height - 38;
        doc.rect(0, footerY - 4, W, 42).fill(GRAY_LIGHT);
        doc.moveTo(0, footerY - 4).lineTo(W, footerY - 4)
            .strokeColor("#e5e7eb").lineWidth(0.5).stroke();

        doc.fillColor(GRAY_TEXT).fontSize(7.5).font("Helvetica")
            .text("Arc Testnet  ·  arc.network  ·  powered by Circle DCW", 0, footerY + 4, {
                align: "center", width: W,
            });

        doc.end();
    });
}
