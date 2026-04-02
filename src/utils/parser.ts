import { logger } from "./logger";

/**
 * Extract text from a file buffer.
 * Handles: PDF, plain text, images (via Tesseract OCR).
 */
export async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
    const mime = mimeType.toLowerCase();

    if (mime === "application/pdf" || (mime === "application/octet-stream" && isPdf(buffer))) {
        return extractPdf(buffer);
    }

    if (mime.startsWith("image/")) {
        return extractImage(buffer);
    }

    // Plain text fallback
    const text = buffer.toString("utf-8").trim();
    if (text.length > 0) return text;

    throw new Error(`Unsupported file type: ${mimeType}`);
}

function isPdf(buffer: Buffer): boolean {
    return buffer.slice(0, 4).toString("ascii") === "%PDF";
}

async function extractPdf(buffer: Buffer): Promise<string> {
    const { PDFParse } = await import("pdf-parse") as any;
    const parser = new PDFParse({});
    await parser.load(buffer);
    const pages: string[] = [];
    const numPages = parser.getInfo()?.numPages ?? 0;
    for (let i = 1; i <= Math.min(numPages, 20); i++) {
        try {
            const pageText: string = await parser.getPageText(i);
            if (pageText?.trim()) pages.push(pageText.trim());
        } catch {
            // skip unreadable page
        }
    }
    parser.destroy();
    return pages.join("\n\n");
}

async function extractImage(buffer: Buffer): Promise<string> {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");
    try {
        const { data } = await worker.recognize(buffer);
        return data.text?.trim() ?? "";
    } finally {
        await worker.terminate();
    }
}
