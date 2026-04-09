import PDFDocument from "pdfkit";
import { ARC_EXPLORER_URL } from "../constants";

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
        const doc = new PDFDocument({ size: "A5", margin: 50 });
        const chunks: Buffer[] = [];
        doc.on("data", (c: Buffer) => chunks.push(c));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        doc.fontSize(18).font("Helvetica-Bold").text("ArcPay Agent", { align: "center" });
        doc.fontSize(11).font("Helvetica").text("Payment Receipt", { align: "center" });
        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke("#cccccc");
        doc.moveDown(0.5);

        doc.fontSize(10).font("Helvetica");
        doc.text(`Date:     ${new Date(data.timestamp).toLocaleString("en-US", { timeZone: "UTC" })} UTC`);
        doc.text(`To:       ${data.vendor}`);
        doc.text(`Address:  ${data.address}`);
        doc.text(`Amount:   ${data.amount} ${data.token}`);
        if (data.memo) doc.text(`Memo:     ${data.memo}`);
        if (data.txHash) {
            doc.moveDown(0.3);
            doc.text(`TxHash:   ${data.txHash}`);
            doc.text(`Explorer: ${ARC_EXPLORER_URL}/tx/${data.txHash}`);
        }

        doc.moveDown(1);
        doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke("#cccccc");
        doc.moveDown(0.5);
        doc.fontSize(8).fillColor("#888888").text("Arc Testnet  ·  arc.network", { align: "center" });

        doc.end();
    });
}
