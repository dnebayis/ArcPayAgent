import { ethers } from "ethers";

const STABLECOIN_DECIMALS = 6;

/**
 * Format a bigint amount (6 decimals) to a human-readable string.
 * e.g., 5000000n → "5.00"
 */
export function formatAmount(amount: bigint): string {
    const str = ethers.formatUnits(amount, STABLECOIN_DECIMALS);
    // Remove trailing zeros but keep at least 2 decimal places
    const [int, dec = ""] = str.split(".");
    const trimmed = dec.replace(/0+$/, "").padEnd(2, "0");
    return `${int}.${trimmed}`;
}

/**
 * Parse a human string like "5.50" into bigint (6 decimals).
 */
export function parseAmount(str: string): bigint {
    return ethers.parseUnits(str, STABLECOIN_DECIMALS);
}

/**
 * Check if a string is a valid positive amount.
 */
export function isValidAmount(str: string): boolean {
    try {
        const amt = parseAmount(str);
        return amt > 0n;
    } catch {
        return false;
    }
}
