import type { PaymentLog } from "../store/payments";

export function paymentsToCSV(payments: PaymentLog[]): Buffer {
    const header = "Date,Vendor,Address,Amount,Token,TxHash,Memo";
    const rows = payments.map(p => {
        const date = new Date(p.timestamp).toISOString();
        return [date, p.vendor, p.address, p.amount, p.token, p.txHash ?? "", p.memo ?? ""]
            .map(v => `"${String(v).replace(/"/g, '""')}"`)
            .join(",");
    });
    return Buffer.from([header, ...rows].join("\n"), "utf-8");
}
