import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");

/**
 * Ensures the data directory exists
 */
function ensureDataDir(): void {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

/**
 * Load JSON data from a file in the data directory.
 * Returns an empty object if the file doesn't exist.
 */
export function loadStore<T extends Record<string, any>>(filename: string): T {
    ensureDataDir();
    const filePath = path.join(DATA_DIR, filename);

    if (!fs.existsSync(filePath)) {
        return {} as T;
    }

    try {
        const raw = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(raw) as T;
    } catch {
        return {} as T;
    }
}

/**
 * Save JSON data to a file in the data directory.
 */
export function saveStore<T extends Record<string, any>>(filename: string, data: T): void {
    ensureDataDir();
    const filePath = path.join(DATA_DIR, filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}
